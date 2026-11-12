// Shapes returned by the Express API (see backend/models and controllers).

export type User = {
  id: string;
  fullName: string;
  email: string;
  role: string;
  permissions?: Record<string, boolean>;
  isActive: boolean;
  createdAt?: string;
};

export type UserRecord = {
  _id: string;
  fullName: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
};

export type Paged<Key extends string, T> = { [K in Key]: T[] } & { total: number; page: number; totalPages: number };

export type Item = {
  _id: string;
  itemCode: string;
  description: string;
  itemGroup?: string;
  itemType?: string;
  uom?: string;
  bomType?: string;
  minStock: number;
  maxStock: number | null;
  reorderLevel: number;
  image: string | null;
  images: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Warehouse = {
  _id: string;
  warehouseCode: string;
  warehouseName: string;
  description?: string;
  location?: string;
  isActive: boolean;
};

export type Zone = {
  _id: string;
  warehouse: Pick<Warehouse, "_id" | "warehouseCode" | "warehouseName"> | string;
  zoneCode: string;
  zoneName: string;
  description?: string;
  isActive: boolean;
};

export type Rack = {
  _id: string;
  zone: string | { _id: string; zoneCode: string };
  rackCode: string;
  rackName: string;
  description?: string;
  isActive: boolean;
};

export type Level = {
  _id: string;
  rack: string | { _id: string; rackCode: string };
  levelCode: string;
  levelName: string;
  levelNumber: number;
  isActive: boolean;
};

export type PopulatedLevel = {
  _id: string;
  levelCode: string;
  rack?: { _id: string; rackCode: string; zone?: { _id: string; zoneCode: string; warehouse?: { _id: string; warehouseCode: string; warehouseName: string } } };
};

export type Bin = {
  _id: string;
  level: PopulatedLevel | string;
  binCode: string;
  binName: string;
  binType: "Dedicated" | "Mixed";
  capacity: number | null;
  capacityUnit: string | null;
  usedCapacity?: number;
  availableCapacity: number | null;
  binStatus?: "Inactive" | "Full" | "Occupied" | "Available";
  containsItem?: boolean;
  locationCode: string | null;
  allowedItemGroups: string[];
  isActive: boolean;
};

export type InventoryRecord = {
  _id: string;
  item: { _id: string; itemCode: string; description: string; uom?: string } | null;
  bin: (Omit<Bin, "level" | "availableCapacity"> & { level: PopulatedLevel }) | null;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  updatedAt: string;
};

export type StockSummaryRow = {
  item: string;
  warehouse: string;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
};

export type Movement = {
  _id: string;
  transactionReference: string;
  movementType: "receipt" | "issue" | "transfer" | "adjustment" | "return";
  item: { _id: string; itemCode: string; description: string; uom?: string } | null;
  sourceBin: { _id: string; binCode: string; binName?: string; locationCode?: string | null } | null;
  destinationBin: { _id: string; binCode: string; binName?: string; locationCode?: string | null } | null;
  quantity: number;
  adjustmentDirection: "increase" | "decrease" | null;
  remarks: string;
  user: { _id: string; fullName: string; email?: string } | null;
  occurredAt: string;
};

export type StockAlert = {
  item: { id: string; itemCode: string; description: string; uom?: string };
  warehouse: string | null;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  minStock: number;
  reorderLevel: number;
  maxStock: number | null;
  outOfStock: boolean;
  belowMinimum: boolean;
  atOrBelowReorder: boolean;
  aboveMaximum: boolean;
  lowStock: boolean;
};

export type Activity = {
  _id: string;
  user: { _id: string; fullName: string; email: string; role: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  details: Record<string, unknown>;
  ipAddress: string;
  createdAt: string;
};

export type MrStatus = "DRAFT" | "PENDING_APPROVAL" | "REJECTED" | "PENDING_ISSUE" | "PARTIALLY_ISSUED" | "ON_HOLD" | "ISSUED" | "RECEIVED";

type MrPerson = { user: string | null; name: string; role: string; date: string | null; remarks: string };

export type MrLine = {
  _id: string;
  item: string;
  itemCode: string;
  description: string;
  uom: string;
  requestedQuantity: number;
  issuedQuantity: number;
  remainingQuantity: number;
  receivedQuantity: number;
  pendingReceiptQuantity: number;
  image: string | null;
  remarks: string;
};

export type MrReceipt = MrPerson & { _id: string; lines: { line: string; itemCode: string; quantity: number }[] };

export type MaterialRequest = {
  _id: string;
  mrNumber: string;
  department: string;
  workOrderNumber: string;
  requestedBy: string;
  requestedByName: string;
  requestDate: string;
  remarks: string;
  status: MrStatus;
  items: MrLine[];
  submittedAt: string | null;
  approval: MrPerson & { decision: "APPROVED" | "REJECTED" | null };
  hold: MrPerson & { previousStatus: string | null };
  issuedAt: string | null;
  receipts: MrReceipt[];
  createdAt: string;
  updatedAt: string;
};

export type MrIssue = {
  _id: string;
  idempotencyKey: string;
  issueType: "full" | "partial";
  lines: { line: string; itemCode: string; bin: string; binCode: string; quantity: number }[];
  issuedByName: string;
  remarks: string;
  issuedAt: string;
};

export type MrAudit = {
  _id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  userName: string;
  role: string;
  remarks: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type MrStockLine = {
  line: string;
  itemCode: string;
  remainingQuantity: number;
  totalAvailable: number;
  bins: { bin: string; binCode: string; locationCode: string | null; warehouse: string; path: string; availableQuantity: number }[];
};

export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export type ItemAvailability = {
  _id: string;
  itemCode: string;
  description: string;
  itemGroup: string;
  itemType: string;
  uom: string;
  image: string | null;
  quantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  stockStatus: StockStatus;
};

export type NewItemStatus = "DRAFT" | "PENDING_EXECUTIVE_REVIEW";

export type NewItemLine = {
  _id: string;
  itemName: string;
  description: string;
  specification: string;
  quantity: number;
  unit: string;
  remarks: string;
  referenceImage: string | null;
};

export type NewItemRequest = {
  _id: string;
  requestNumber: string;
  department: string;
  requestedBy: string;
  requestedByName: string;
  requestDate: string;
  projectName: string;
  workOrderNumber: string;
  priority: "Low" | "Normal" | "High" | "Urgent";
  justification: string;
  remarks: string;
  status: NewItemStatus;
  submittedAt: string | null;
  items: NewItemLine[];
  createdAt: string;
  updatedAt: string;
};

export function binLocation(bin: { binCode: string; locationCode?: string | null } | null | undefined) {
  if (!bin) return "—";
  return bin.locationCode || bin.binCode;
}

export function levelPath(level: PopulatedLevel | string | null | undefined) {
  if (!level || typeof level === "string") return "";
  const rack = level.rack;
  const zone = rack?.zone;
  const warehouse = zone?.warehouse;
  return [warehouse?.warehouseCode, zone?.zoneCode, rack?.rackCode, level.levelCode].filter(Boolean).join(" / ");
}
