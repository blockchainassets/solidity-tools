import debugModule from "debug";
const debug = debugModule("decoder-core:allocate:calldata");

import { CalldataPointer } from "../types/pointer";
import { CalldataAllocations, CalldataAllocation, CalldataMemberAllocation } from "../types/allocation";
import { AstDefinition, AstReferences } from "truffle-decode-utils";
import * as DecodeUtils from "truffle-decode-utils";

interface CalldataAllocationInfo {
  size?: number; //left out for types that don't go in calldata
  dynamic?: boolean; //similarly
  allocations: CalldataAllocations;
}

export function getCalldataAllocations(referenceDeclarations: AstReferences): CalldataAllocations {
  let allocations: CalldataAllocations = {};
  for(const node of Object.values(referenceDeclarations)) {
    if(node.nodeType === "StructDefinition") {
      allocations = allocateStruct(node, referenceDeclarations, allocations);
    }
  }
  return allocations;
}

//note: we will still allocate circular structs, even though they're not allowed in calldata, because it's
//not worth the effort to detect them.  However on mappings or internal functions, we'll vomit (allocate null)
function allocateStruct(definition: AstDefinition, referenceDeclarations: AstReferences, existingAllocations: CalldataAllocations): CalldataAllocations {
  let start: number = 0;
  let dynamic: boolean = false;

  //don't allocate things that have already been allocated
  if(definition.id in existingAllocations) {
    return existingAllocations;
  }

  let allocations = {...existingAllocations}; //otherwise, we'll be adding to this, so we better clone

  let memberAllocations: CalldataMemberAllocation[] = [];

  for(const member of definition.members)
  {
    let length: number;
    let dynamicMember: boolean;
    ({size: length, dynamic: dynamicMember, allocations} = calldataSizeAndAllocate(member, referenceDeclarations, allocations));

    //vomit on illegal types in calldata -- note the short-circuit!
    if(length === undefined) {
      allocations[definition.id] = null;
      return allocations;
    }

    let pointer: CalldataPointer = {
      calldata: {
        start,
        length
      }
    };

    memberAllocations.push({
      definition: member,
      pointer
    });

    start += length;
    dynamic = dynamic || dynamicMember;
  }

  allocations[definition.id] = {
    definition,
    members: memberAllocations,
    length: dynamic ? DecodeUtils.EVM.WORD_SIZE : start,
    dynamic
  };

  return allocations;
}

function calldataSizeAndAllocate(definition: AstDefinition, referenceDeclarations?: AstReferences, existingAllocations?: CalldataAllocations): CalldataAllocationInfo {
  switch (DecodeUtils.Definition.typeClass(definition)) {
    case "bool":
    case "address":
    case "contract":
    case "int":
    case "uint":
    case "fixed":
    case "ufixed":
    case "enum":
      return {
	size: DecodeUtils.EVM.WORD_SIZE,
	dynamic: false,
	allocations: existingAllocations
      };

    case "string":
      return {
	size: DecodeUtils.EVM.WORD_SIZE,
	dynamic: true,
	allocations: existingAllocations
      };

    case "bytes":
      return {
	size: DecodeUtils.EVM.WORD_SIZE,
	dynamic: DecodeUtils.Definition.specifiedSize(definition) == null,
	allocations: existingAllocations
      };

    case "mapping":
      return {
	allocations: existingAllocations
      };

    case "function":
      switch (DecodeUtils.Definition.visibility(definition)) {
        case "external":
	  return {
	    size: DecodeUtils.EVM.WORD_SIZE,
	    dynamic: false,
	    allocations: existingAllocations
	  };
        case "internal":
	  return {
	    allocations: existingAllocations
	  };
      }

    case "array": {
      if(DecodeUtils.Definition.isDynamicArray(definition)) {
	return {
	  size: DecodeUtils.EVM.WORD_SIZE,
	  dynamic: true,
	  allocations: existingAllocations
	};
      }
      else {
        //static array case
        const length: number = DecodeUtils.Definition.staticLength(definition);
        if(length === 0) {
          //arrays of length 0 are static regardless of base type
	  return {
	    size: 0,
	    dynamic: false,
	    allocations: existingAllocations
	  };
        }
        const baseDefinition: AstDefinition = definition.baseType || definition.typeName.baseType;
	const {size: baseSize, dynamic, allocations} = calldataSizeAndAllocate(baseDefinition, referenceDeclarations, existingAllocations);
	return {
	  size: length * baseSize,
	  dynamic,
	  allocations
	};
      }
    }

    case "struct": {
      const referenceId: number = DecodeUtils.Definition.typeId(definition);
      let allocations: CalldataAllocations = existingAllocations;
      let allocation: CalldataAllocation | null | undefined = allocations[referenceId];
      if(allocation === undefined) {
        //if we don't find an allocation, we'll have to do the allocation ourselves
        const referenceDeclaration: AstDefinition = referenceDeclarations[referenceId];
        allocations = allocateStruct(referenceDeclaration, referenceDeclarations, existingAllocations);
        allocation = allocations[referenceId];
      }
      //having found our allocation, if it's not null, we can just look up its size and dynamicity
      if(allocation !== null) {
	return {
	  size: allocation.length,
	  dynamic: allocation.dynamic,
	  allocations
	};
      }
      //if it is null, this type doesn't go in calldata
      else {
	return {
	  allocations
	};
      }
    }
  }
}

//like calldataSize, but for a Type object; also assumes you've already done allocation
//(note: function for dynamic is separate, see below)
//also, does not attempt to handle types that don't occur in calldata
export function calldataSizeForType(dataType: DecodeUtils.Types.Type, allocations: CalldataAllocations): number {
  switch(dataType.typeClass) {
    case "array":
      switch(dataType.kind) {
        case "dynamic":
          return DecodeUtils.EVM.WORD_SIZE;
        case "static":
          const length = dataType.length.toNumber(); //if this is too big, we have a problem!
          const baseSize = calldataSizeForType(dataType.baseType, allocations);
          return length * baseSize;
      }
    case "struct":
      const allocation = allocations[dataType.id];
      if(!allocation) {
        throw new DecodeUtils.Errors.DecodingError(
          new DecodeUtils.Errors.UserDefinedTypeNotFoundError(dataType)
        );
      }
      return allocation.length;
    default:
      return DecodeUtils.EVM.WORD_SIZE;
  }
}

//again, this function does not attempt to handle types that don't occur in calldata
export function isTypeDynamic(dataType: DecodeUtils.Types.Type, allocations: CalldataAllocations): boolean {
  switch(dataType.typeClass) {
    case "string":
      return true;
    case "bytes":
      return dataType.kind === "dynamic";
    case "array":
      return dataType.kind === "dynamic" || (dataType.length.gtn(0) && isTypeDynamic(dataType.baseType, allocations));
    case "struct":
      const allocation = allocations[dataType.id];
      if(!allocation) {
        throw new DecodeUtils.Errors.DecodingError(
          new DecodeUtils.Errors.UserDefinedTypeNotFoundError(dataType)
        );
      }
      return allocation.dynamic;
    default:
      return false;
  }
}
