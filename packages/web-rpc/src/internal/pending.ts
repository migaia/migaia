export type IPending<T> = {
  readonly resolve: (value: T) => void;
  readonly reject: (error: unknown) => void;
  readonly timer?: ReturnType<typeof setTimeout>;
  readonly signal?: AbortSignal;
  readonly abort?: () => void;
};
