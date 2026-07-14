import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { UserRepository } from '../../domain/repositories/user.repository';
import { CreateAdminDto } from '../dtos/auth.dto';
import { UserRole, KafkaTopic } from '@ecommerce/shared';
import { ConflictError } from '@ecommerce/errors';
import { KafkaProducer } from '@ecommerce/kafka-client';

interface CreateAdminResult {
  id: string;
  email: string;
  role: UserRole;
  firstName: string;
  lastName: string;
}

// Only reachable via requirePermission(Permission.CREATE_ADMIN), which only super-admin holds.
export class CreateAdminUseCase {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly kafkaProducer: KafkaProducer,
  ) {}

  async execute(dto: CreateAdminDto): Promise<CreateAdminResult> {
    const existing = await this.userRepo.findByEmail(dto.email);
    if (existing) throw new ConflictError('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.userRepo.create({
      id: uuidv4(),
      email: dto.email,
      passwordHash,
      role: UserRole.ADMIN,
      firstName: dto.firstName,
      lastName: dto.lastName,
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
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }
}
