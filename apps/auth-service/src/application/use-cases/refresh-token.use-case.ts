import { v4 as uuidv4 } from 'uuid';
import { UserRepository, AgentProfileRepository, RefreshTokenRepository } from '../../domain/repositories/user.repository';
import { TokenService } from '../../domain/services/token.service';
import { UnauthorizedError } from '@ecommerce/errors';
import { withTransaction } from '../../infrastructure/db/pool';

interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export class RefreshTokenUseCase {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly agentProfileRepo: AgentProfileRepository,
    private readonly refreshTokenRepo: RefreshTokenRepository,
    private readonly tokenService: TokenService,
  ) {}

  async execute(token: string): Promise<RefreshResult> {
    let payload;
    try {
      payload = this.tokenService.verifyRefreshToken(token);
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    const tokenHash = this.tokenService.hashToken(token);
    const stored = await this.refreshTokenRepo.findByHash(tokenHash);
    if (!stored) throw new UnauthorizedError('Refresh token revoked or expired');

    const user = await this.userRepo.findById(payload.sub);
    if (!user || !user.isActive) throw new UnauthorizedError('User not found or inactive');

    let agentId: string | undefined;
    if (user.role === 'agent') {
      const profile = await this.agentProfileRepo.findByUserId(user.id);
      agentId = profile?.id;
    }

    return withTransaction(async (client) => {
      await this.refreshTokenRepo.deleteById(stored.id, client);

      const jti = uuidv4();
      const newRefreshToken = this.tokenService.signRefreshToken({ sub: user.id, jti });
      const newHash = this.tokenService.hashToken(newRefreshToken);

      await this.refreshTokenRepo.create(
        {
          id: jti,
          userId: user.id,
          tokenHash: newHash,
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

      return { accessToken, refreshToken: newRefreshToken };
    });
  }
}
