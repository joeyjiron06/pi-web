import * as immutable from "object-path-immutable";

type PathSegment<T, Key extends string> =
  T extends ReadonlyArray<infer Element>
    ? Key extends `${number}`
      ? Element
      : Key extends keyof T
        ? T[Key]
        : never
    : Key extends keyof T
      ? T[Key]
      : never;

type DottedPath<
  T,
  Path extends string,
> = Path extends `${infer Key}.${infer Rest}`
  ? DottedPath<PathSegment<T, Key>, Rest>
  : PathSegment<T, Path>;

type ArrayElement<T> = T extends ReadonlyArray<infer Element> ? Element : never;

interface WrappedObject<T> {
  set<Path extends string>(
    path: Path,
    value: NoInfer<DottedPath<T, Path>>,
  ): WrappedObject<T>;
  push<Path extends string>(
    path: Path,
    ...values: Array<NoInfer<ArrayElement<DottedPath<T, Path>>>>
  ): WrappedObject<T>;
  del<Path extends string>(path: Path): WrappedObject<T>;
  assign<Path extends string>(
    path: Path,
    source: NoInfer<DottedPath<T, Path>>,
  ): WrappedObject<T>;
  merge<Path extends string>(
    path: Path,
    source: NoInfer<DottedPath<T, Path>>,
  ): WrappedObject<T>;
  update<Path extends string>(
    path: Path,
    updater: (formerValue: DottedPath<T, Path>) => NoInfer<DottedPath<T, Path>>,
  ): WrappedObject<T>;
  insert<Path extends string>(
    path: Path,
    value: NoInfer<ArrayElement<DottedPath<T, Path>>>,
    index: number,
  ): WrappedObject<T>;
  value(): T;
}

export const wrap = immutable.wrap as <T>(object: T) => WrappedObject<T>;

export const set = immutable.set as <T, Path extends string>(
  source: T,
  path: Path,
  value: NoInfer<DottedPath<T, Path>>,
) => T;

export const del = immutable.del as <T, Path extends string>(
  source: T,
  path: Path,
) => T;
