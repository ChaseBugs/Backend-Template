import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { UserRepository, AgentProfileRepository } from '../../domain/repositories/user.repository';
import { TokenService } from '../../domain/services/token.service';
import { RefreshTokenRepository } from '../../domain/repositories/user.repository';
import { RegisterUserDto } from '../dtos/auth.dto';
import { UserRole, KafkaTopic } from '@ecommerce/shared';
import { ConflictError } from '@ecommerce/errors';
import { KafkaProducer } from '@ecommerce/kafka-client';
import { withTransaction } from '../../infrastructure/db/pool';

interface RegisterResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    role: UserRole;
    firstName: string;
    lastName: string;
  };
}

export class RegisterUseCase {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly agentProfileRepo: AgentProfileRepository,
    private readonly refreshTokenRepo: RefreshTokenRepository,
    private readonly tokenService: TokenService,
    private readonly kafkaProducer: KafkaProducer,
  ) {}

  async execute(dto: RegisterUserDto): Promise<RegisterResult> {
    const existing = await this.userRepo.findByEmail(dto.email);
    if (existing) throw new ConflictError('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const userId = uuidv4();

    return withTransaction(async (client) => {
      const user = await this.userRepo.create(
        {
          id: userId,
          email: dto.email,
          passwordHash,
          role: dto.role,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
        },
        client,
      );

      let agentId: string | undefined;

      if (dto.role === UserRole.AGENT) {
        const agentProfile = await this.agentProfileRepo.create(
          {
            id: uuidv4(),
            userId: user.id,
            businessName: dto.businessName!,
            businessNumber: dto.businessNumber!,
          },
          client,
        );
        agentId = agentProfile.id;
      }

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

      await this.kafkaProducer.send(
        KafkaTopic.USER_REGISTERED,
        {
          topic: KafkaTopic.USER_REGISTERED,
          payload: {
            userId: user.id,
            email: user.email,
            role: user.role,
            firstName: user.firstName,
            lastName: user.lastName,
          },
        },
        user.id,
      );

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
