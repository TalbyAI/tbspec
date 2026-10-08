declare module "shacl-engine" {
  import type { DataFactory, Store, Term } from "n3";
  export class Validator {
    constructor(
      shapes: Store,
      options: { factory: typeof DataFactory & { dataset: () => Store }; validations?: unknown },
    );
    validate(data: { dataset: Store }): Promise<{
      conforms: boolean;
      results: {
        focusNode: { term: Term };
        shape: { ptr: { term: Term } };
        constraintComponent: Term;
        message: { value: string }[];
      }[];
    }>;
  }
}
declare module "shacl-engine/sparql.js" {
  export const validations: unknown;
}
