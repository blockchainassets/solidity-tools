import {
  mergeSchemas,
  transformSchema,
  FilterRootFields
} from "@gnd/graphql-tools";

import { schema as rootSchema } from "truffle-db/schema";
import { schema as jsonSchema } from "./json";

export const schema = mergeSchemas({
  schemas: [
    rootSchema,
    transformSchema(jsonSchema, [
      new FilterRootFields( (_, rootField) => rootField !== "contract"),
      new FilterRootFields( (_, rootField) => rootField !== "contractNames"),
    ]),
    `type Query {
      contractNames: [String]!
      contract(name: String!): Contract
      contractInstance(networkId: String!, name: String!): ContractInstance
    }`
  ],
  resolvers: {
    Query: {
      contractNames: {
        resolve: (_, args, context, info) => info.mergeInfo.delegateToSchema({
          schema: jsonSchema,
          operation: "query",
          fieldName: "contractNames",
          args,
          context,
          info
        })
      },
      contract: {
        resolve: (_, args, context, info) => info.mergeInfo.delegateToSchema({
          schema: jsonSchema,
          operation: "query",
          fieldName: "contract",
          args,
          context,
          info
        })
      },
      contractInstance: {
        resolve: (_, args, context, info) => info.mergeInfo.delegateToSchema({
          schema: jsonSchema,
          operation: "query",
          fieldName: "contract",
          args,
          context,
          info,
        })
      }
    },

    ContractInstance: {
      address: {
        fragment: `... on ContractObject {
          networks {
            networkObject {
              address
              name
              id
            }
          }
        }`,
        resolve: (obj) => {
          const { networks } = obj;
          const result = networks
            .map(
              ({ networkObject: { address } }) => address
            )[0];

          return result;
        }
      },
      network: {
        fragment: `... on ContractObject {
          networks {
            networkId
          }
        }`,
        resolve: (obj) => {
          const { networks } = obj;
          const result = networks
            .map( ({ networkId }) => ({ networkID: networkId }))[0]

          return result;
        }
      },
      contract: {
        fragment: `... on ContractObject { name: contractName }`,
        resolve: ({ name }, _, context, info) =>
          info.mergeInfo.delegateToSchema({
            schema: jsonSchema,
            operation: "query",
            fieldName: "contract",
            args: { name },
            context,
            info
          })
      },
      callBytecode: {
        fragment: `... on ContractObject {
          deployedSourceMap,
          deployedBytecode
        }`,
        resolve: ({
          deployedBytecode: bytes,
          deployedSourceMap: sourceMap
        }) => ({ bytes, sourceMap })
      },
    },

    Contract: {
      name: {
        fragment: `... on ContractObject { name: contractName }`
      },
      sourceContract: {
        fragment: `... on ContractObject {
          ast { json }
          source { contents, sourcePath }
        }`,
        resolve: (obj) => {
          const { name, source, ast } = obj;
          const sourceContract = {
            name: name,
            source: source,
            ast: ast
          }
          return sourceContract;
        }
      },
      constructor: {
        fragment: `... on ContractObject {
            bytecode
          }`,
          resolve: (obj) => {
            const { bytecode } = obj;
            const contractConstructor = {
              createBytecode: {
                bytes: bytecode
              }
            }
            return contractConstructor;
          }
        }
      },
    }
});
