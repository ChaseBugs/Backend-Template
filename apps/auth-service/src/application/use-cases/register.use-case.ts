import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { UserRepository, AgentProfileRepository } from '../../domain/repositories/user.repository';
import { TokenService } from '../../domain/services/token.service';
import { RefreshTokenRepository } from '../../domain/repositories/user.repository';
import { RegisterUserDto } from '../dtos/auth.dto';
import { UserRole, KafkaTopic, AgentApprovalStatus } from '@ecommerce/shared';
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
    if (existing) {
      const credentialsMatch = await bcrypt.compare(dto.password, existing.passwordHash);
      const identityMatches = existing.role === dto.role && existing.firstName === dto.firstName
        && existing.lastName === dto.lastName && existing.phone === dto.phone;
      if (!credentialsMatch || !identityMatches) throw new ConflictError('Email already registered');
      const profile = dto.role === UserRole.AGENT ? await this.agentProfileRepo.findByUserId(existing.id) : null;
      if (dto.role === UserRole.AGENT
        && (!profile || profile.businessName !== dto.businessName || profile.businessNumber !== dto.businessNumber)) {
        throw new ConflictError('Email already registered with different agent details');
      }
      const approvedAgentId = profile?.approvalStatus === AgentApprovalStatus.APPROVED ? profile.id : undefined;
      const result = await this.createSession(existing, approvedAgentId);
      await this.publishRegistered(existing);
      if (profile) await this.publishAgentApplication(profile);
      return result;
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const userId = uuidv4();

    let createdAgent: { id: string; userId: string; businessName: string; businessNumber: string } | undefined;
    const result = await withTransaction(async (client) => {
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

      if (dto.role === UserRole.AGENT) {
        createdAgent = await this.agentProfileRepo.create(
          {
            id: uuidv4(),
            userId: user.id,
            businessName: dto.businessName!,
            businessNumber: dto.businessNumber!,
          },
          client,
        );
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
        agentId: undefined,
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
    await this.publishRegistered(result.user);
    if (createdAgent) await this.publishAgentApplication(createdAgent);
    return result;
  }

  private async createSession(user: { id: string; email: string; role: UserRole; firstName: string; lastName: string }, agentId?: string): Promise<RegisterResult> {
    const jti = uuidv4();
    const refreshToken = this.tokenService.signRefreshToken({ sub: user.id, jti });
    await this.refreshTokenRepo.create({
      id: jti,
      userId: user.id,
      tokenHash: this.tokenService.hashToken(refreshToken),
      expiresAt: this.tokenService.getRefreshExpiryDate(),
      createdAt: new Date(),
    });
    return {
      accessToken: this.tokenService.signAccessToken({ sub: user.id, email: user.email, role: user.role, agentId }),
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName },
    };
  }

  private async publishRegistered(user: { id: string; email: string; role: UserRole; firstName: string; lastName: string }): Promise<void> {
    await this.kafkaProducer.send(KafkaTopic.USER_REGISTERED, {
      topic: KafkaTopic.USER_REGISTERED,
      payload: { userId: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName },
    }, user.id);
  }

  private async publishAgentApplication(profile: { id: string; userId: string; businessName: string; businessNumber: string }): Promise<void> {
    await this.kafkaProducer.send(KafkaTopic.AGENT_APPLICATION_SUBMITTED, {
      topic: KafkaTopic.AGENT_APPLICATION_SUBMITTED,
      payload: {
        agentId: profile.id,
        userId: profile.userId,
        businessName: profile.businessName,
        businessNumber: profile.businessNumber,
      },
    }, profile.id, profile.id);
  }
}
