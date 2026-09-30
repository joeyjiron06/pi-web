export type FileOrFolder = FileItem | FolderItem;

export type FolderItem = {
  // full path on the filesystem
  path: string;

  // relative to the home directory, for display purposes. uses '~' for home dir
  displayPath: string;

  // name of the folder (last segment of the path)
  name: string;

  kind: "folder";
};

export type FileItem = {
  // full path on the filesystem
  path: string;

  // relative to the home directory, for display purposes. uses '~' for home dir
  displayPath: string;

  // name of the folder (last segment of the path)
  name: string;

  kind: "file";
};

/**
 * A fuzzy-search hit. Carries the path relative to the searched root, which is
 * both what the fuzzy matcher scores against and what the UI should render --
 * `src/routes/fs/find.ts` is far more useful in a result list than an absolute
 * path. Not part of {@link FileItem}/{@link FolderItem} because those are
 * rootless and have nothing to be relative to.
 */
export type FindMatch = FileOrFolder & { relativePath: string };
