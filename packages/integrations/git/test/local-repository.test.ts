import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalRepository,
  LocalRepository,
  parseGitHubRemote,
  readGitContext,
} from "../src/local-repository.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "maintainerkit-git-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(path: string, content: string): Promise<void> {
  const absolute = join(root, path);
  await mkdir(join(absolute, ".."), { recursive: true });
  await writeFile(absolute, content, "utf8");
}

describe("local repository source", () => {
  it("lists files with sizes and reads contents", async () => {
    await write("README.md", "# Widget\n");
    await write("docs/guide.md", "Guide\n");

    const repo = await createLocalRepository({ root });
    const snapshot = await repo.getRepository();

    expect(snapshot.files.map((file) => file.path)).toEqual(["README.md", "docs/guide.md"]);
    expect(snapshot.hasFile?.("README.md")).toBe(true);
    expect(snapshot.hasFile?.("readme.md")).toBe(true);
    expect(await snapshot.readFile?.("README.md")).toBe("# Widget\n");
    expect(await snapshot.readFile?.("missing.md")).toBeNull();
  });

  it("ignores dependency and build directories", async () => {
    await write("README.md", "# Widget\n");
    await write("node_modules/left-pad/index.js", "module.exports = 1\n");
    await write("dist/bundle.js", "x\n");
    await write(".git/config", "[core]\n");

    const snapshot = await (await createLocalRepository({ root })).getRepository();
    expect(snapshot.files.map((file) => file.path)).toEqual(["README.md"]);
  });

  it("refuses path traversal and absolute paths", async () => {
    await write("README.md", "# Widget\n");
    const snapshot = await (await createLocalRepository({ root })).getRepository();

    expect(await snapshot.readFile?.("../../etc/passwd")).toBeNull();
    expect(await snapshot.readFile?.("C:/Windows/win.ini")).toBeNull();
    expect(await snapshot.readFile?.("/etc/passwd")).toBeNull();
  });

  it("does not read files above the size cap", async () => {
    await write("huge.txt", "x".repeat(300 * 1024));
    const snapshot = await (await createLocalRepository({ root })).getRepository();
    expect(await snapshot.readFile?.("huge.txt")).toBeNull();
  });

  it("caps the number of indexed files", async () => {
    for (let index = 0; index < 12; index += 1) {
      await write(`file-${index}.txt`, "x");
    }
    const repo = new LocalRepository({ root, maxFiles: 5 });
    const snapshot = await repo.getRepository();
    expect(snapshot.files.length).toBeLessThanOrEqual(5);
  });

  it("rejects a path that is not a directory", async () => {
    await write("file.txt", "x");
    await expect(createLocalRepository({ root: join(root, "file.txt") })).rejects.toThrow(
      /Not a directory/,
    );
  });

  it("reports a filesystem provider with git context when available", async () => {
    await write("README.md", "# Widget\n");
    const snapshot = await (await createLocalRepository({ root })).getRepository();
    expect(snapshot.ref.provider).toBe("filesystem");
    expect(snapshot.ref.name.length).toBeGreaterThan(0);
  });
});

describe("git metadata", () => {
  it("reports no git repository for a plain directory", async () => {
    const context = await readGitContext(root);
    expect(context.isGitRepository).toBe(false);
  });

  it("parses the common remote URL forms", () => {
    expect(parseGitHubRemote("https://github.com/acme/widget.git")).toEqual({
      owner: "acme",
      name: "widget",
    });
    expect(parseGitHubRemote("https://github.com/acme/widget")).toEqual({
      owner: "acme",
      name: "widget",
    });
    expect(parseGitHubRemote("git@github.com:acme/widget.git")).toEqual({
      owner: "acme",
      name: "widget",
    });
    expect(parseGitHubRemote("ssh://git@example.com/acme/widget.git")).toBeNull();
    expect(parseGitHubRemote("not a url")).toBeNull();
  });
});
