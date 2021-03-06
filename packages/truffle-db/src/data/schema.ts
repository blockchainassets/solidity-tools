import { transformSchema, FilterRootFields } from "@gnd/graphql-tools";

import { scopeSchemas } from "./utils";

import { abiSchema, schema as artifactsSchema } from "truffle-db/artifacts";
import { schema as workspaceSchema } from "truffle-db/workspace";
import { schema as resourcesSchema } from "truffle-db/resources";
import { loaderSchema } from "truffle-db/loaders";

export const schema = scopeSchemas({
  subschemas: {
    artifacts: artifactsSchema,
    workspace: workspaceSchema,
    loaders: loaderSchema
  },
  typeDefs: [
    // add types from abi schema
    transformSchema(abiSchema, [
      new FilterRootFields( () => false )
    ]),
    resourcesSchema
  ],
  resolvers: {
    AbiItem: {
      __resolveType(obj) {
        switch (obj.type) {
          case "event":
            return "Event";
          case "constructor":
            return "ConstructorFunction";
          case "fallback":
            return "FallbackFunction";
          case "function":
          default:
            return "NormalFunction";
        }
      }
    },

    NormalFunction: {
      type: {
        resolve (value) {
          return "function";
        }
      }
    }

  }
});
