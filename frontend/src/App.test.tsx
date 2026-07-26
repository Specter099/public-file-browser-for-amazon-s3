// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import type { S3Client } from "@aws-sdk/client-s3";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.tsx";
import type { SiteConfig } from "./lib/config.ts";

const CONFIG: SiteConfig = {
  siteName: "AnyCompany Public Files",
  identityPoolId: "us-west-2:pool",
  bucketName: "test-bucket",
  filesOpenInNewTab: true,
  visibleStorageClasses: ["STANDARD", "STANDARD_IA"],
};

interface S3Object {
  Key: string;
  Size: number;
  LastModified: Date;
  StorageClass: string;
}

function object(key: string, size = 100, iso = "2024-05-01T12:00:00Z"): S3Object {
  return { Key: key, Size: size, LastModified: new Date(iso), StorageClass: "STANDARD" };
}

/**
 * Fake S3 client driven by a per-prefix response map, so navigation can be
 * exercised end to end without the AWS SDK or network.
 */
function clientFor(
  responses: Record<string, { folders?: string[]; files?: S3Object[]; truncated?: boolean }>,
) {
  const send = vi.fn(async (command: { input: Record<string, unknown> }) => {
    const prefix = (command.input.Prefix as string | undefined) ?? "";
    const page = responses[prefix] ?? {};
    return {
      Prefix: prefix,
      CommonPrefixes: (page.folders ?? []).map((folder) => ({ Prefix: folder })),
      Contents: page.files ?? [],
      IsTruncated: page.truncated === true,
    };
  });
  return { client: { send } as unknown as S3Client, send };
}

function renderApp(client: S3Client, config: SiteConfig = CONFIG) {
  return render(<App config={config} client={client} />);
}

beforeEach(() => {
  window.history.pushState(null, "", "/");
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listing", () => {
  it("renders folders and files from the bucket root", async () => {
    const { client } = clientFor({
      "": { folders: ["photos/"], files: [object("readme.md", 2048)] },
    });

    renderApp(client);

    expect(await screen.findByRole("link", { name: /photos\//i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /readme\.md/i })).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("sets the document title from the site name and prefix", async () => {
    const { client } = clientFor({ "": { files: [object("a.txt")] } });

    renderApp(client);

    await waitFor(() => expect(document.title).toBe("AnyCompany Public Files - /"));
  });

  it("shows an empty-bucket message when the root has no entries", async () => {
    const { client } = clientFor({ "": {} });

    renderApp(client);

    expect(await screen.findByText(/this bucket is empty/i)).toBeInTheDocument();
  });

  it("surfaces an error when the listing call fails", async () => {
    const send = vi.fn(async () => {
      throw new Error("AccessDenied: not allowed");
    });
    renderApp({ send } as unknown as S3Client);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not load this folder/i);
    expect(alert).toHaveTextContent(/AccessDenied/);
  });

  it("hides objects whose storage class is not visible", async () => {
    const { client } = clientFor({
      "": {
        files: [
          object("visible.txt"),
          { ...object("cold.txt"), StorageClass: "GLACIER" },
        ],
      },
    });

    renderApp(client);

    expect(await screen.findByRole("link", { name: /visible\.txt/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /cold\.txt/i })).not.toBeInTheDocument();
  });
});

describe("navigation", () => {
  it("navigates into a folder and updates the URL", async () => {
    const user = userEvent.setup();
    const { client } = clientFor({
      "": { folders: ["photos/"] },
      "photos/": { files: [object("photos/cat.jpg")] },
    });

    renderApp(client);

    await user.click(await screen.findByRole("link", { name: /photos\//i }));

    expect(await screen.findByRole("link", { name: /cat\.jpg/i })).toBeInTheDocument();
    expect(window.location.search).toBe("?p=photos%2F");
  });

  it("offers a parent link inside a folder but not at the root", async () => {
    const user = userEvent.setup();
    const { client } = clientFor({
      "": { folders: ["photos/"] },
      "photos/": { files: [object("photos/cat.jpg")] },
    });

    renderApp(client);
    await screen.findByRole("link", { name: /photos\//i });
    expect(screen.queryByRole("link", { name: ".." })).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /photos\//i }));

    expect(await screen.findByRole("link", { name: ".." })).toBeInTheDocument();
  });

  it("reads the initial prefix from the query string", async () => {
    window.history.pushState(null, "", "/?p=photos%2F");
    const { client } = clientFor({ "photos/": { files: [object("photos/cat.jpg")] } });

    renderApp(client);

    expect(await screen.findByRole("link", { name: /cat\.jpg/i })).toBeInTheDocument();
  });

  it("responds to browser Back via popstate", async () => {
    const user = userEvent.setup();
    const { client } = clientFor({
      "": { folders: ["photos/"] },
      "photos/": { files: [object("photos/cat.jpg")] },
    });

    renderApp(client);
    await user.click(await screen.findByRole("link", { name: /photos\//i }));
    await screen.findByRole("link", { name: /cat\.jpg/i });

    window.history.pushState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(await screen.findByRole("link", { name: /photos\//i })).toBeInTheDocument();
  });

  it("renders breadcrumbs for a nested prefix", async () => {
    window.history.pushState(null, "", "/?p=a%2Fb%2F");
    const { client } = clientFor({ "a/b/": { files: [object("a/b/f.txt")] } });

    renderApp(client);

    const nav = await screen.findByRole("navigation", { name: /breadcrumb/i });
    expect(within(nav).getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "a" })).toBeInTheDocument();
    // The current folder is the page, not a link.
    expect(within(nav).queryByRole("link", { name: "b" })).not.toBeInTheDocument();
    expect(within(nav).getByText("b")).toHaveAttribute("aria-current", "page");
  });
});

describe("security", () => {
  it("renders a script-like prefix as inert text, not markup", async () => {
    // The pre-rebuild app built breadcrumb HTML by concatenation and needed
    // escapeHtml() here. React escapes text children, so the payload must show
    // up as literal text with no injected element.
    const payload = '<img src=x onerror=alert(1)>';
    window.history.pushState(null, "", `/?p=${encodeURIComponent(`${payload}/`)}`);
    const { client } = clientFor({ [`${payload}/`]: {} });

    renderApp(client);

    const nav = await screen.findByRole("navigation", { name: /breadcrumb/i });
    expect(within(nav).getByText(payload)).toBeInTheDocument();
    expect(nav.querySelector("img")).toBeNull();
    expect(document.querySelector("img[src='x']")).toBeNull();
  });

  it("adds rel=noopener noreferrer to every new-tab file link", async () => {
    const { client } = clientFor({ "": { files: [object("doc.pdf")] } });

    renderApp(client);

    const link = await screen.findByRole("link", { name: /doc\.pdf/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("omits target and rel when configured to open in the same tab", async () => {
    const { client } = clientFor({ "": { files: [object("doc.pdf")] } });

    renderApp(client, { ...CONFIG, filesOpenInNewTab: false });

    const link = await screen.findByRole("link", { name: /doc\.pdf/i });
    expect(link).not.toHaveAttribute("target");
    expect(link).not.toHaveAttribute("rel");
  });

  it("percent-encodes object keys in download links", async () => {
    const { client } = clientFor({ "": { files: [object('quote"key.txt')] } });

    renderApp(client);

    const link = await screen.findByRole("link", { name: /quote"key\.txt/i });
    expect(link).toHaveAttribute("href", "/quote%22key.txt");
  });
});

describe("filter", () => {
  it("narrows the listing and reports the filtered count", async () => {
    const user = userEvent.setup();
    const { client } = clientFor({
      "": { files: [object("report.pdf"), object("README.md"), object("photo.png")] },
    });

    renderApp(client);
    await screen.findByRole("link", { name: /report\.pdf/i });

    await user.type(screen.getByRole("searchbox", { name: /filter/i }), "re");

    expect(screen.getByRole("link", { name: /report\.pdf/i })).toBeInTheDocument();
    // Case-insensitive: "re" matches "README.md".
    expect(screen.getByRole("link", { name: /README\.md/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /photo\.png/i })).not.toBeInTheDocument();
    expect(screen.getByText("2 of 3 shown")).toBeInTheDocument();
  });

  it("reports when nothing matches", async () => {
    const user = userEvent.setup();
    const { client } = clientFor({ "": { files: [object("alpha.txt")] } });

    renderApp(client);
    await screen.findByRole("link", { name: /alpha\.txt/i });

    await user.type(screen.getByRole("searchbox", { name: /filter/i }), "nope");

    expect(await screen.findByText(/nothing matches your filter/i)).toBeInTheDocument();
  });

  it("clears the filter when navigating to another folder", async () => {
    const user = userEvent.setup();
    const { client } = clientFor({
      "": { folders: ["photos/"], files: [object("alpha.txt")] },
      "photos/": { files: [object("photos/cat.jpg")] },
    });

    renderApp(client);
    await screen.findByRole("link", { name: /photos\//i });

    const search = screen.getByRole("searchbox", { name: /filter/i });
    await user.type(search, "photos");
    await user.click(screen.getByRole("link", { name: /photos\//i }));

    await screen.findByRole("link", { name: /cat\.jpg/i });
    expect(search).toHaveValue("");
  });
});

describe("sorting", () => {
  it("sorts by size and toggles direction on repeated clicks", async () => {
    const user = userEvent.setup();
    const { client } = clientFor({
      "": { files: [object("mid.txt", 500), object("big.txt", 9000), object("small.txt", 10)] },
    });

    renderApp(client);
    await screen.findByRole("link", { name: /mid\.txt/i });

    const sizeHeader = screen.getByRole("button", { name: /size/i });

    await user.click(sizeHeader);
    expect(
      screen.getAllByRole("row").slice(1).map((row) => row.textContent),
    ).toEqual(expect.arrayContaining([expect.stringContaining("small.txt")]));
    const ascendingOrder = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("a")?.textContent ?? "");
    expect(ascendingOrder).toEqual(["small.txt", "mid.txt", "big.txt"]);

    await user.click(sizeHeader);
    const descendingOrder = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("a")?.textContent ?? "");
    expect(descendingOrder).toEqual(["big.txt", "mid.txt", "small.txt"]);
  });

  it("exposes sort state to assistive tech via aria-sort", async () => {
    const user = userEvent.setup();
    const { client } = clientFor({ "": { files: [object("a.txt")] } });

    renderApp(client);
    await screen.findByRole("link", { name: /a\.txt/i });

    await user.click(screen.getByRole("button", { name: /size/i }));

    expect(screen.getByRole("columnheader", { name: /size/i })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });

  it("keeps folders above files by default", async () => {
    const { client } = clientFor({
      "": { folders: ["zzz-folder/"], files: [object("aaa.txt")] },
    });

    renderApp(client);
    await screen.findByRole("link", { name: /aaa\.txt/i });

    const order = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("a")?.textContent ?? "");
    expect(order).toEqual(["zzz-folder/", "aaa.txt"]);
  });
});

describe("view mode", () => {
  it("switches between list and grid", async () => {
    const user = userEvent.setup();
    const { client } = clientFor({ "": { files: [object("photo.png")] } });

    renderApp(client);
    await screen.findByRole("link", { name: /photo\.png/i });
    expect(screen.getByRole("table")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Grid" }));

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("link", { name: /photo\.png/i })).toBeInTheDocument();
  });

  it("shows an image thumbnail in grid view and an icon for other types", async () => {
    const user = userEvent.setup();
    const { client } = clientFor({
      "": { files: [object("photo.png"), object("notes.txt")] },
    });

    renderApp(client);
    await screen.findByRole("link", { name: /photo\.png/i });
    await user.click(screen.getByRole("button", { name: "Grid" }));

    const images = document.querySelectorAll("img");
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute("src", "/photo.png");
    expect(images[0]).toHaveAttribute("loading", "lazy");
  });

  it("does not inline an SVG object as a thumbnail", async () => {
    // An attacker-supplied SVG rendered same-origin can carry script.
    const user = userEvent.setup();
    const { client } = clientFor({ "": { files: [object("logo.svg")] } });

    renderApp(client);
    await screen.findByRole("link", { name: /logo\.svg/i });
    await user.click(screen.getByRole("button", { name: "Grid" }));

    expect(document.querySelector("img")).toBeNull();
  });
});

describe("pagination", () => {
  it("shows a next-page control only when the listing is truncated", async () => {
    const { client } = clientFor({ "": { files: [object("a.txt")], truncated: false } });

    renderApp(client);
    await screen.findByRole("link", { name: /a\.txt/i });

    expect(screen.queryByRole("button", { name: /next page/i })).not.toBeInTheDocument();
  });

  it("keeps lexicographic ordering on the final, un-truncated page", async () => {
    // The last page of a multi-page listing is not truncated, but regrouping
    // folders above files there would visibly flip ordering mode mid-listing.
    window.history.pushState(null, "", "/?s=m.txt");
    const { client } = clientFor({
      "": { folders: ["zzz-folder/"], files: [object("nnn.txt")], truncated: false },
    });

    renderApp(client);
    await screen.findByRole("link", { name: /nnn\.txt/i });

    const order = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.querySelector("a")?.textContent ?? "");
    expect(order).toEqual(["nnn.txt", "zzz-folder/"]);
  });

  it("offers a next page even when every object on the page is hidden", async () => {
    // Regression: deriving the cursor from visible entries stranded everything
    // past a page whose objects were all filtered out by storage class.
    const send = vi.fn(async (command: { input: Record<string, unknown> }) => {
      const startAfter = command.input.StartAfter as string | undefined;
      return startAfter === undefined
        ? {
            Prefix: "",
            Contents: [{ ...object("cold.txt"), StorageClass: "GLACIER" }],
            IsTruncated: true,
          }
        : { Prefix: "", Contents: [object("warm.txt")], IsTruncated: false };
    });

    const user = userEvent.setup();
    renderApp({ send } as unknown as S3Client);

    const next = await screen.findByRole("button", { name: /next page/i });
    await user.click(next);

    expect(await screen.findByRole("link", { name: /warm\.txt/i })).toBeInTheDocument();
    expect(window.location.search).toBe("?s=cold.txt");
  });

  it("advances to the next page using the last key as the cursor", async () => {
    const user = userEvent.setup();
    const send = vi.fn(async (command: { input: Record<string, unknown> }) => {
      const startAfter = command.input.StartAfter as string | undefined;
      return startAfter === undefined
        ? {
            Prefix: "",
            Contents: [object("a.txt"), object("b.txt")],
            IsTruncated: true,
          }
        : { Prefix: "", Contents: [object("c.txt")], IsTruncated: false };
    });

    renderApp({ send } as unknown as S3Client);
    await screen.findByRole("link", { name: /a\.txt/i });

    await user.click(screen.getByRole("button", { name: /next page/i }));

    expect(await screen.findByRole("link", { name: /c\.txt/i })).toBeInTheDocument();
    expect(window.location.search).toBe("?s=b.txt");
  });
});

describe("theme", () => {
  it("cycles system -> light -> dark and marks the document element", async () => {
    const user = userEvent.setup();
    const { client } = clientFor({ "": { files: [object("a.txt")] } });

    renderApp(client);
    await screen.findByRole("link", { name: /a\.txt/i });

    const root = document.documentElement;
    expect(root.classList.contains("light")).toBe(false);
    expect(root.classList.contains("dark")).toBe(false);

    await user.click(screen.getByRole("button", { name: /match system theme/i }));
    expect(root.classList.contains("light")).toBe(true);

    await user.click(screen.getByRole("button", { name: /light theme/i }));
    expect(root.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("pfb-theme")).toBe("dark");
  });

  it("restores a persisted preference on load", async () => {
    window.localStorage.setItem("pfb-theme", "dark");
    const { client } = clientFor({ "": { files: [object("a.txt")] } });

    renderApp(client);
    await screen.findByRole("link", { name: /a\.txt/i });

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});
