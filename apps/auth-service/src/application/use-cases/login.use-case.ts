import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { UserRepository, AgentProfileRepository, RefreshTokenRepository } from '../../domain/repositories/user.repository';
import { TokenService } from '../../domain/services/token.service';
import { LoginDto } from '../dtos/auth.dto';
import { AgentApprovalStatus } from '@ecommerce/shared';
import { UnauthorizedError, ForbiddenError } from '@ecommerce/errors';
import { withTransaction } from '../../infrastructure/db/pool';

interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    role: string;
    firstName: string;
    lastName: string;
  };
}

export class LoginUseCase {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly agentProfileRepo: AgentProfileRepository,
    private readonly refreshTokenRepo: RefreshTokenRepository,
    private readonly tokenService: TokenService,
  ) {}

  async execute(dto: LoginDto): Promise<LoginResult> {
    const user = await this.userRepo.findByEmail(dto.email);
    if (!user) throw new UnauthorizedError('Invalid email or password');
    if (!user.isActive) throw new ForbiddenError('Account is deactivated');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedError('Invalid email or password');

    let agentId: string | undefined;
    if (user.role === 'agent') {
      const profile = await this.agentProfileRepo.findByUserId(user.id);
      if (!profile) throw new ForbiddenError('Agent profile not found');
      if (profile.approvalStatus === AgentApprovalStatus.PENDING) {
        throw new ForbiddenError('Agent account pending approval');
      }
      if (profile.approvalStatus === AgentApprovalStatus.REJECTED) {
        throw new ForbiddenError('Agent account has been rejected');
      }
      agentId = profile.id;
    }

    return withTransaction(async (client) => {
      await this.userRepo.updateLastLogin(user.id, client);

      const jti = uuidv4();
      const refreshTokenStr = this.tokenService.signRefreshToken({ sub: user.id, jti });
      const tokenHash = this.tokenService.hashToken(refreshTokenStr);

      await this.refreshTokenRepo.create(
        {
          id: jti,
          userId: user.id,
          tokenHash,
          expiresAt: this.tokenService.getRefreshExpiryDate(),
          createdAt: new Date(),
        },
        client,
      );

      const accessToken = this.tokenService.signAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        agentId,
      });

      return {
        accessToken,
        refreshToken: refreshTokenStr,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName,
        },
      };
    });
  }
}
