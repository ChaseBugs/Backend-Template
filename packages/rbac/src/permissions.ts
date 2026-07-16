import { UserRole } from '@ecommerce/shared';

export enum Permission {
  // User management
  CREATE_ADMIN = 'create:admin',
  CHANGE_USER_ROLE = 'change:user_role',
  READ_ALL_USERS = 'read:all_users',
  UPDATE_ANY_USER = 'update:any_user',
  DELETE_ANY_USER = 'delete:any_user',
  READ_AUDIT_LOG = 'read:audit_log',
  SET_COMMISSION = 'set:commission',

  // Agent management
  APPROVE_AGENT = 'approve:agent',
  REJECT_AGENT = 'reject:agent',
  READ_ALL_AGENTS = 'read:all_agents',

  // Product management
  CREATE_PRODUCT = 'create:product',
  UPDATE_OWN_PRODUCT = 'update:own_product',
  DELETE_OWN_PRODUCT = 'delete:own_product',
  DELETE_ANY_PRODUCT = 'delete:any_product',
  APPROVE_PRODUCT = 'approve:product',
  REJECT_PRODUCT = 'reject:product',
  READ_ANY_PRODUCT = 'read:any_product',
  MODERATE_PRODUCT = 'moderate:product',

  // Order management
  CREATE_ORDER = 'create:order',
  READ_OWN_ORDERS = 'read:own_orders',
  READ_AGENT_ORDERS = 'read:agent_orders',
  READ_ALL_ORDERS = 'read:all_orders',
  CANCEL_OWN_ORDER = 'cancel:own_order',
  CANCEL_ANY_ORDER = 'cancel:any_order',
  UPDATE_ANY_ORDER_STATUS = 'update:any_order_status',

  // Inventory management
  UPDATE_OWN_INVENTORY = 'update:own_inventory',
  READ_OWN_INVENTORY = 'read:own_inventory',
  READ_ALL_INVENTORY = 'read:all_inventory',

  // Delivery management
  UPDATE_OWN_DELIVERY = 'update:own_delivery',
  READ_OWN_DELIVERY = 'read:own_delivery',
  READ_ALL_DELIVERIES = 'read:all_deliveries',
  REQUEST_RETURN = 'request:return',
  APPROVE_RETURN = 'approve:return',

  // Payment management
  READ_OWN_PAYMENTS = 'read:own_payments',
  READ_AGENT_PAYMENTS = 'read:agent_payments',
  READ_ALL_PAYMENTS = 'read:all_payments',
  ISSUE_REFUND = 'issue:refund',

  // Cart management
  MANAGE_OWN_CART = 'manage:own_cart',

  // Admin dashboard
  READ_DASHBOARD = 'read:dashboard',
  READ_REPORTS = 'read:reports',
  READ_SETTLEMENTS = 'read:settlements',
  MANAGE_SETTLEMENTS = 'manage:settlements',

  // Ad campaign management (sponsored product placement)
  READ_ALL_AD_CAMPAIGNS = 'read:all_ad_campaigns',
  MODERATE_AD_CAMPAIGN = 'moderate:ad_campaign',
}

const rolePermissions: Record<UserRole, Permission[]> = {
  [UserRole.SUPER_ADMIN]: Object.values(Permission),

  [UserRole.ADMIN]: [
    Permission.APPROVE_AGENT,
    Permission.REJECT_AGENT,
    Permission.READ_ALL_AGENTS,
    Permission.READ_ALL_USERS,
    Permission.UPDATE_ANY_USER,
    Permission.APPROVE_PRODUCT,
    Permission.REJECT_PRODUCT,
    Permission.READ_ANY_PRODUCT,
    Permission.MODERATE_PRODUCT,
    Permission.DELETE_ANY_PRODUCT,
    Permission.READ_ALL_ORDERS,
    Permission.CANCEL_ANY_ORDER,
    Permission.UPDATE_ANY_ORDER_STATUS,
    Permission.READ_ALL_INVENTORY,
    Permission.READ_ALL_DELIVERIES,
    Permission.APPROVE_RETURN,
    Permission.READ_ALL_PAYMENTS,
    Permission.ISSUE_REFUND,
    Permission.READ_DASHBOARD,
    Permission.READ_REPORTS,
    Permission.READ_ALL_AD_CAMPAIGNS,
    Permission.MODERATE_AD_CAMPAIGN,
  ],

  [UserRole.AGENT]: [
    Permission.CREATE_PRODUCT,
    Permission.UPDATE_OWN_PRODUCT,
    Permission.DELETE_OWN_PRODUCT,
    Permission.READ_AGENT_ORDERS,
    Permission.UPDATE_OWN_INVENTORY,
    Permission.READ_OWN_INVENTORY,
    Permission.UPDATE_OWN_DELIVERY,
    Permission.READ_OWN_DELIVERY,
    Permission.APPROVE_RETURN,
    Permission.READ_AGENT_PAYMENTS,
  ],

  [UserRole.USER]: [
    Permission.CREATE_ORDER,
    Permission.READ_OWN_ORDERS,
    Permission.CANCEL_OWN_ORDER,
    Permission.MANAGE_OWN_CART,
    Permission.READ_OWN_PAYMENTS,
    Permission.REQUEST_RETURN,
    Permission.READ_OWN_DELIVERY,
  ],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return rolePermissions[role]?.includes(permission) ?? false;
}

export function getPermissions(role: UserRole): Permission[] {
  return [...(rolePermissions[role] ?? [])];
}
