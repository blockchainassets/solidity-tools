import fs from "fs";
import path from "path";
import gql from "graphql-tag";
import { TruffleDB } from "truffle-db";
import { ArtifactsLoader } from "truffle-db/loaders/artifacts";
import { generateId } from "truffle-db/helpers";
import * as Contracts from "truffle-workflow-compile";
import Migrate from "truffle-migrate";
import { Environment } from "truffle-environment";
import * as Config from "truffle-config";
import * as Ganache from "ganache-core"
import Web3 from "web3";
import * as fse from "fs-extra";

let server;
const port = 8545;

const fixturesDirectory = path.join(
  __dirname, // truffle-db/src/loaders/artifacts/test
  "..", // truffle-db/src/loaders/artifacts
  "..", // truffle-db/src/loaders
  "..", // truffle-db/src/
  "..", // truffle-db/
  "test",
  "fixtures"
);

const sourcesDirectory = path.join(fixturesDirectory, "sources");
const buildDirectory = path.join(fixturesDirectory, "build");
const compilationSourcesDirectory = path.join(fixturesDirectory, "compilationSources");

beforeAll(async (done)=> {
  server = Ganache.server();
  server.listen(port, done);
});

afterAll(async (done) => {
  setTimeout(() => server.close(done), 500);
});

// mocking the truffle-workflow-compile to avoid jest timing issues
// and also to keep from adding more time to Travis testing
jest.mock("truffle-workflow-compile", () => ({
  compile: function(config, callback) {
    const magicSquare = require(path.join(sourcesDirectory, "MagicSquare.json"));
    const migrations = require(path.join(sourcesDirectory, "Migrations.json"));
    const squareLib = require(path.join(sourcesDirectory, "SquareLib.json"));
    const vyperStorage = require(path.join(sourcesDirectory, "VyperStorage.json"));
    const returnValue = {
      "outputs": {
        "solc": [
          "/Users/fainashalts/solidity-magic-square/contracts/MagicSquare.sol",
          "/Users/fainashalts/solidity-magic-square/contracts/Migrations.sol",
          "/Users/fainashalts/solidity-magic-square/contracts/SquareLib.sol"
        ],
        "vyper": [
           "/Users/fainashalts/truffle-six/testing2/contracts/VyperStorage.vy",
        ]
      },
      "contracts": [{
        "contract_name": "MagicSquare",
        ...magicSquare
      },
      {
        "contract_name": "Migrations",
        ...migrations
      },
      {
        "contract_name": "SquareLib",
        ...squareLib
      },
      {
        "contract_name": "VyperStorage",
        ...vyperStorage
      },
      ]
    }
    return returnValue;
  }
}));

// minimal config
const config = {
  contracts_build_directory: sourcesDirectory
};

const compilationConfig =  {
  contracts_directory: compilationSourcesDirectory,
  contracts_build_directory: path.join(compilationSourcesDirectory, "contracts"),
  artifacts_directory: path.join(compilationSourcesDirectory, "build", "contracts"),
  all: true
}

const migratedArtifacts = [
  require(path.join(compilationSourcesDirectory, "build", "contracts", "MagicSquare.json")),
  require(path.join(compilationSourcesDirectory, "build", "contracts", "Migrations.json")),
  require(path.join(compilationSourcesDirectory, "build", "contracts", "SquareLib.json")),
  require(path.join(compilationSourcesDirectory, "build", "contracts", "VyperStorage.json"))
 ];

const migrationFileNames = ["MagicSquare.json", "Migrations.json", "SquareLib.json", "VyperStorage.json"];

const migrationConfig = Config.detect({
  workingDirectory: compilationSourcesDirectory
});
migrationConfig.network = "development";

const db = new TruffleDB(config);

const artifacts = [
  require(path.join(sourcesDirectory, "MagicSquare.json")),
  require(path.join(sourcesDirectory, "Migrations.json")),
  require(path.join(sourcesDirectory, "SquareLib.json")),
  require(path.join(sourcesDirectory, "VyperStorage.json"))
];

const GetWorkspaceBytecode: boolean = gql`
query GetWorkspaceBytecode($id: ID!) {
  workspace {
    bytecode(id: $id) {
      id
      bytes
    }
  }
}`;

const GetWorkspaceSource: boolean = gql`
query GetWorkspaceSource($id: ID!) {
  workspace {
    source(id: $id) {
      id
      contents
      sourcePath
    }
  }
}`;

const GetWorkspaceContract = gql`
query GetWorkspaceContract($id:ID!){
  workspace {
    contract(id:$id) {
      id
      name
      abi {
        json
      }
      constructor {
        createBytecode {
          bytes
        }
      }
      sourceContract {
        source {
          contents
          sourcePath
        }
        ast {
          json
        }
        source {
          contents
          sourcePath
        }
      }
      compilation {
        compiler {
          name
          version
        }
        sources {
          contents
          sourcePath
        }
        contracts {
          name
          source {
            contents
            sourcePath
          }
        }
      }
    }
  }
}`;

const GetWorkspaceCompilation: boolean = gql`
query getWorkspaceCompilation($id: ID!) {
  workspace {
    compilation(id: $id) {
      compiler {
        name
        version
      }
      contracts {
        name
        source {
          contents
          sourcePath
        }
        ast {
          json
        }
      }
      sources {
        id
        contents
        sourcePath
      }
    }
  }
}`;

const GetWorkspaceNetwork: boolean = gql`
query GetWorkspaceNetwork($id: ID!) {
  workspace {
    network(id: $id) {
      networkId
      id
      name
      historicBlock {
        height
        hash
      }
    }
  }
}`;

const GetWorkspaceContractInstance: boolean = gql`
query GetContractInstance($id: ID!) {
  workspace {
    contractInstance(id: $id) {
      address
      network {
        networkId
      }
      contract {
        name
      }
    }
  }
}`;

describe("Compilation", () => {
  let sourceIds= [];
  let bytecodeIds = [];
  let compilationIds = [];
  let netIds = [];
  let migratedNetworks = [];
  let contractInstanceIds = [];
  let contractInstances = [];
  let expectedSolcCompilationId;
  let expectedVyperCompilationId;

  beforeAll(async () => {
    await Environment.detect(migrationConfig);
    const web3 = new Web3(migrationConfig.provider);
    const networkId = await web3.eth.net.getId();
    migrationConfig.reset = true;
    await Migrate.run(migrationConfig);
    await Promise.all(artifacts.map(async(contract, index) => {
      let sourceId = generateId({
        contents: contract["source"],
        sourcePath: contract["sourcePath"]
      });
      sourceIds.push({id: sourceId});

      let bytecodeId = generateId({
        bytes: contract["bytecode"]
      });
      bytecodeIds.push({ id: bytecodeId });

      let networks = JSON.parse(await fse.readFile(path.join(compilationSourcesDirectory, "build", "contracts", migrationFileNames[index]))).networks;
      const networksArray = Object.entries(networks);

      if(networksArray.length > 0) {
        const transaction = await web3.eth.getTransaction(networksArray[networksArray.length -1][1]["transactionHash"]);
        const historicBlock = {
          height: transaction.blockNumber,
          hash: transaction.blockHash
        }

        const netId = generateId({
          networkId: networkId,
          historicBlock: historicBlock
        });
        netIds.push({ id: netId });
        migratedNetworks.push({
          networkId: networkId,
          historicBlock: historicBlock
        })
        const contractInstanceId = generateId({
          network: {
            id: netId
          },
          address: networksArray[networksArray.length -1][1]["address"]
        });
        contractInstanceIds.push({ id: contractInstanceId });
        contractInstances.push({
          address: networksArray[networksArray.length -1][1]["address"],
          network: {
            name: 'development',
            networkId: networkId,
            historicBlock: historicBlock
          },
          contract: {
            name: contract["contractName"]
          }
        })
      }

    }));


    expectedSolcCompilationId = generateId({
      compiler: artifacts[0].compiler,
      sourceIds: [sourceIds[0], sourceIds[1], sourceIds[2]]
    });
    expectedVyperCompilationId = generateId({
      compiler: artifacts[3].compiler,
      sourceIds: [sourceIds[3]]
    });
    compilationIds.push({ id: expectedSolcCompilationId }, { id: expectedVyperCompilationId });

    const loader = new ArtifactsLoader(db, compilationConfig);
    await loader.load();
  });

  afterAll(async() => {
    await Promise.all(artifacts.map(async(contract, index) => {
    let migratedArtifact = JSON.parse(await fse.readFile(path.join(compilationSourcesDirectory, "build", "contracts", migrationFileNames[index])));
    migratedArtifact.networks = {};
    migratedArtifact.updatedAt = '';
    await fse.remove(path.join(compilationSourcesDirectory, "build", "contracts", migrationFileNames[index]));
    await fse.writeFile(path.join(compilationSourcesDirectory, "build", "contracts", migrationFileNames[index]), JSON.stringify(migratedArtifact, null, 2));
    }));
  });

  it("loads compilations", async () => {
    const compilationsQuery = await Promise.all(compilationIds.map(
      (compilationId) => {
        let compilation = db.query(GetWorkspaceCompilation, compilationId);
        return compilation;
    }));

    const solcCompilation = compilationsQuery[0].data.workspace.compilation;
    expect(solcCompilation.compiler.version).toEqual(artifacts[0].compiler.version);
    expect(solcCompilation.sources.length).toEqual(3);
    solcCompilation.sources.map((source, index)=> {
      expect(source.id).toEqual(sourceIds[index].id);
      expect(source["contents"]).toEqual(artifacts[index].source);
      expect(solcCompilation.contracts[index].name).toEqual(artifacts[index].contractName);
    });

    const vyperCompilation =  compilationsQuery[1].data.workspace.compilation
    expect(vyperCompilation.compiler.version).toEqual(artifacts[3].compiler.version);
    expect(vyperCompilation.sources.length).toEqual(1);
    expect(vyperCompilation.sources[0].id).toEqual(sourceIds[3].id);
    expect(vyperCompilation.sources[0].contents).toEqual(artifacts[3].source);
    expect(vyperCompilation.contracts[0].name).toEqual(artifacts[3].contractName);
  });

  it("loads contract sources", async () => {
    for(let index in sourceIds) {
      let {
        data: {
          workspace: {
            source: {
              contents,
              sourcePath
            }
          }
        }
      } = await db.query(GetWorkspaceSource, sourceIds[index]);

      expect(contents).toEqual(artifacts[index].source);
      expect(sourcePath).toEqual(artifacts[index].sourcePath);
    }
  });

  it("loads bytecodes", async () => {
    for(let index in bytecodeIds) {
      let {
        data: {
          workspace: {
            bytecode: {
              bytes
            }
          }
        }
      } = await db.query(GetWorkspaceBytecode, bytecodeIds[index]);

      expect(bytes).toEqual(artifacts[index].bytecode);

    }
  });

  it("loads contracts", async () => {
    let contractIds = [];

    for(let index in artifacts) {
      let expectedId = generateId({
        name: artifacts[index].contractName,
        abi: { json: JSON.stringify(artifacts[index].abi) },
        sourceContract: { index: artifacts[index].compiler.name === "solc" ? +index : 0},
        compilation: {
          id: artifacts[index].compiler.name === "solc" ? expectedSolcCompilationId : expectedVyperCompilationId
        }
      });

      contractIds.push({ id: expectedId });
      let {
        data: {
          workspace: {
            contract: {
              id,
              name,
              constructor: {
                createBytecode: {
                  bytes
                }
              },
              sourceContract: {
                source: {
                  contents
                }
              },
              compilation: {
                compiler: {
                  version
                }
              }
            }
          }
        }
      } = await db.query(GetWorkspaceContract, contractIds[index]);

      expect(name).toEqual(artifacts[index].contractName);
      expect(bytes).toEqual(artifacts[index].bytecode);
      expect(contents).toEqual(artifacts[index].source);
      expect(version).toEqual(artifacts[index].compiler.version);
      expect(id).toEqual(contractIds[index].id);
    }
  });

  it("loads networks", async() => {
    for(let index in migratedArtifacts) {
      let {
        data: {
          workspace: {
            network: {
              name,
              networkId,
              historicBlock
            }
          }
        }
      } = await db.query(GetWorkspaceNetwork, netIds[index]);

      expect(name).toEqual("development");
      expect(networkId).toEqual(migratedNetworks[index]["networkId"]);
      expect(historicBlock).toEqual(migratedNetworks[index]["historicBlock"]);
    }
  });

  it("loads contract instances", async() => {
    for(let index in migratedArtifacts) {
      let {
        data: {
          workspace: {
            contractInstance: {
              address,
              network: {
                networkId
              },
              contract: {
                name
              }
            }
          }
        }
      } = await db.query(GetWorkspaceContractInstance, contractInstanceIds[index]);

      expect(name).toEqual(contractInstances[index].contract.name);
      expect(networkId).toEqual(contractInstances[index].network.networkId);
      expect(address).toEqual(contractInstances[index].address);
    }
  })
});
