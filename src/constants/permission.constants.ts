export const PERMISSIONS = {
  CUSTOMER_CREATE: "customer:create",
  CUSTOMER_READ: "customer:read",
  CUSTOMER_UPDATE: "customer:update",
  CUSTOMER_DELETE: "customer:delete",

  SERVICE_REQUEST_CREATE: "service_request:create",
  SERVICE_REQUEST_READ: "service_request:read",
  SERVICE_REQUEST_UPDATE: "service_request:update",
  SERVICE_REQUEST_DELETE: "service_request:delete",

  JOB_CREATE: "job:create",
  JOB_READ: "job:read",
  JOB_UPDATE: "job:update",
  JOB_DELETE: "job:delete",

  INVOICE_CREATE: "invoice:create",
  INVOICE_READ: "invoice:read",
  INVOICE_UPDATE: "invoice:update",
  INVOICE_DELETE: "invoice:delete",
} as const;
