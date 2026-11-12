// Describes each level of the Warehouse → Zone → Rack → Level → Bin hierarchy:
// which endpoints it uses and which fields its form edits (all taken from backend/models).

export type LocationKind = "warehouse" | "zone" | "rack" | "level" | "bin";

export type LocationField = {
  name: string;
  label: string;
  type?: "text" | "number" | "select" | "list";
  required?: boolean;
  options?: string[];
  hint?: string;
  editable?: boolean;
};

export type LocationConfig = {
  kind: LocationKind;
  label: string;
  plural: string;
  codeField: string;
  nameField: string;
  parentField: string | null;
  listPath: (parentId: string | null) => string;
  responseKey: string | null; // null = endpoint returns a plain array
  basePath: string;
  fields: LocationField[];
  deactivate: (id: string) => { method: "delete" | "patch"; path: string };
  activate: (id: string) => { method: "put" | "patch"; path: string; body?: unknown };
};

export const HIERARCHY: LocationKind[] = ["warehouse", "zone", "rack", "level", "bin"];

export const LOCATION_CONFIG: Record<LocationKind, LocationConfig> = {
  warehouse: {
    kind: "warehouse",
    label: "Warehouse",
    plural: "Warehouses",
    codeField: "warehouseCode",
    nameField: "warehouseName",
    parentField: null,
    listPath: () => "/warehouses",
    responseKey: null,
    basePath: "/warehouses",
    fields: [
      { name: "warehouseCode", label: "Warehouse code", required: true },
      { name: "warehouseName", label: "Warehouse name", required: true },
      { name: "location", label: "Location / address" },
      { name: "description", label: "Description" },
    ],
    deactivate: (id) => ({ method: "delete", path: `/warehouses/${id}` }),
    activate: (id) => ({ method: "put", path: `/warehouses/${id}`, body: { isActive: true } }),
  },
  zone: {
    kind: "zone",
    label: "Zone",
    plural: "Zones",
    codeField: "zoneCode",
    nameField: "zoneName",
    parentField: "warehouse",
    listPath: (parentId) => `/zones?warehouse=${parentId}`,
    responseKey: null,
    basePath: "/zones",
    fields: [
      { name: "zoneCode", label: "Zone code", required: true },
      { name: "zoneName", label: "Zone name", required: true },
      { name: "description", label: "Description" },
    ],
    deactivate: (id) => ({ method: "delete", path: `/zones/${id}` }),
    activate: (id) => ({ method: "put", path: `/zones/${id}`, body: { isActive: true } }),
  },
  rack: {
    kind: "rack",
    label: "Rack",
    plural: "Racks",
    codeField: "rackCode",
    nameField: "rackName",
    parentField: "zone",
    listPath: (parentId) => `/racks?zone=${parentId}&limit=100`,
    responseKey: "racks",
    basePath: "/racks",
    fields: [
      { name: "rackCode", label: "Rack code", required: true },
      { name: "rackName", label: "Rack name", required: true },
      { name: "description", label: "Description" },
    ],
    deactivate: (id) => ({ method: "patch", path: `/racks/${id}/deactivate` }),
    activate: (id) => ({ method: "patch", path: `/racks/${id}/reactivate` }),
  },
  level: {
    kind: "level",
    label: "Level",
    plural: "Levels",
    codeField: "levelCode",
    nameField: "levelName",
    parentField: "rack",
    listPath: (parentId) => `/levels?rack=${parentId}&limit=100`,
    responseKey: "levels",
    basePath: "/levels",
    fields: [
      { name: "levelCode", label: "Level code", required: true },
      { name: "levelName", label: "Level name", required: true },
      { name: "levelNumber", label: "Level number", type: "number", required: true, hint: "1 = lowest shelf" },
    ],
    deactivate: (id) => ({ method: "patch", path: `/levels/${id}/deactivate` }),
    activate: (id) => ({ method: "patch", path: `/levels/${id}/reactivate` }),
  },
  bin: {
    kind: "bin",
    label: "Bin",
    plural: "Bins",
    codeField: "binCode",
    nameField: "binName",
    parentField: "level",
    listPath: (parentId) => `/bins?level=${parentId}&limit=100`,
    responseKey: "bins",
    basePath: "/bins",
    fields: [
      { name: "binCode", label: "Bin code", required: true },
      { name: "binName", label: "Bin name", required: true },
      { name: "binType", label: "Bin type", type: "select", options: ["Mixed", "Dedicated"], hint: "Dedicated bins hold one item at a time" },
      { name: "locationCode", label: "Location code", hint: "Optional unique label, e.g. WH1-Z1-R1-L1-B1" },
      { name: "capacity", label: "Capacity", type: "number", hint: "Leave empty for an untracked capacity" },
      { name: "capacityUnit", label: "Capacity unit", hint: "Must equal the item UoM (e.g. Pieces) to store items" },
      { name: "allowedItemGroups", label: "Allowed item groups", type: "list", hint: "Comma separated. Leave empty to allow all groups" },
    ],
    deactivate: (id) => ({ method: "patch", path: `/bins/${id}/deactivate` }),
    activate: (id) => ({ method: "patch", path: `/bins/${id}/reactivate` }),
  },
};
