import { z } from 'zod';
import { UserRole } from '@ecommerce/shared';

export const RegisterUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().max(20).optional(),
  role: z.enum([UserRole.USER, UserRole.AGENT]).default(UserRole.USER),
  // agent-only fields
  businessName: z.string().min(1).max(255).optional(),
  businessNumber: z.string().min(1).max(50).optional(),
}).refine(
  (data) => {
    if (data.role === UserRole.AGENT) {
      return !!data.businessName && !!data.businessNumber;
    }
    return true;
  },
  { message: 'businessName and businessNumber are required for agent registration' },
);

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const CreateAdminSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: z.enum([UserRole.ADMIN]),
});

export const ApproveAgentSchema = z.object({
  commissionRate: z.number().min(0).max(100).optional(),
});

export const RejectAgentSchema = z.object({
  reason: z.string().min(1).max(500),
});

export const UpdateShippingPolicySchema = z.object({
  baseShippingFee: z.number().int().min(0),
  freeShippingThreshold: z.number().int().min(0).nullable().optional(),
  remoteAreaFee: z.number().int().min(0),
  supportedCouriers: z.array(z.string()),
  defaultCourier: z.string().optional(),
});

export const SetCommissionRateSchema = z.object({
  agentId: z.string().uuid(),
  commissionRate: z.number().min(0).max(100),
});

export const ChangeUserRoleSchema = z.object({
  role: z.enum([UserRole.ADMIN, UserRole.USER]),
});

export type RegisterUserDto = z.infer<typeof RegisterUserSchema>;
export type LoginDto = z.infer<typeof LoginSchema>;
export type RefreshTokenDto = z.infer<typeof RefreshTokenSchema>;
export type CreateAdminDto = z.infer<typeof CreateAdminSchema>;
export type ApproveAgentDto = z.infer<typeof ApproveAgentSchema>;
export type RejectAgentDto = z.infer<typeof RejectAgentSchema>;
export type UpdateShippingPolicyDto = z.infer<typeof UpdateShippingPolicySchema>;
export type SetCommissionRateDto = z.infer<typeof SetCommissionRateSchema>;
export type ChangeUserRoleDto = z.infer<typeof ChangeUserRoleSchema>;
