import { RefreshTokenRepository } from '../../domain/repositories/user.repository';
import { TokenService } from '../../domain/services/token.service';
import { UnauthorizedError } from '@ecommerce/errors';

export class LogoutUseCase {
  constructor(
    private readonly refreshTokenRepo: RefreshTokenRepository,
    private readonly tokenService: TokenService,
  ) {}

  async execute(refreshToken: string, requesterId: string): Promise<void> {
    let payload;
    try {
      payload = this.tokenService.verifyRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedError('Invalid or expired refresh token');
    }

    if (payload.sub !== requesterId) throw new UnauthorizedError('Refresh token does not belong to the authenticated user');

    const stored = await this.refreshTokenRepo.findByHash(this.tokenService.hashToken(refreshToken));
    if (!stored) return; // Logout is safely repeatable after the token has been revoked.
    if (stored.userId !== requesterId || stored.id !== payload.jti) {
      throw new UnauthorizedError('Refresh token does not belong to the authenticated user');
    }
    await this.refreshTokenRepo.deleteById(stored.id);
  }
}
