export enum UserRole {
  SUPER_ADMIN = 'super-admin',
  ADMIN = 'admin',
  AGENT = 'agent',
  USER = 'user',
}

export const ALL_ROLES = Object.values(UserRole);

export function isValidRole(role: string): role is UserRole {
  return ALL_ROLES.includes(role as UserRole);
}
