import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 26.5.0 — 讲台（Podium）：班级应用授权、班级作业与提交、班级 AI 额度池。
 */
export class Migration1785283200001 implements MigrationInterface {
    name = "Migration1785283200001";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

        await queryRunner.query(`
            ALTER TABLE "organization"
            ADD COLUMN IF NOT EXISTS "app_whitelist_enabled" boolean NOT NULL DEFAULT false
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "organization_app_grant" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP WITH TIME ZONE,
                "organization_id" uuid NOT NULL,
                "user_id" uuid,
                "app_type" varchar(16) NOT NULL,
                "app_ref_id" uuid NOT NULL,
                "granted_by_user_id" uuid NOT NULL,
                CONSTRAINT "PK_organization_app_grant" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_organization_app_grant_target" UNIQUE ("organization_id", "user_id", "app_type", "app_ref_id"),
                CONSTRAINT "FK_organization_app_grant_org" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_organization_app_grant_org" ON "organization_app_grant" ("organization_id")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_organization_app_grant_user" ON "organization_app_grant" ("user_id")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_organization_app_grant_ref" ON "organization_app_grant" ("app_ref_id")`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "organization_assignment" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP WITH TIME ZONE,
                "organization_id" uuid NOT NULL,
                "owner_user_id" uuid NOT NULL,
                "title" varchar(100) NOT NULL,
                "description" text NOT NULL DEFAULT '',
                "due_at" TIMESTAMP WITH TIME ZONE,
                "allowed_types" jsonb NOT NULL DEFAULT '["workflow","agent"]'::jsonb,
                "status" varchar(16) NOT NULL DEFAULT 'draft',
                CONSTRAINT "PK_organization_assignment" PRIMARY KEY ("id"),
                CONSTRAINT "FK_organization_assignment_org" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_organization_assignment_org" ON "organization_assignment" ("organization_id")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_organization_assignment_owner" ON "organization_assignment" ("owner_user_id")`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "organization_assignment_submission" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP WITH TIME ZONE,
                "assignment_id" uuid NOT NULL,
                "organization_id" uuid NOT NULL,
                "student_user_id" uuid NOT NULL,
                "target_type" varchar(16) NOT NULL,
                "target_id" uuid NOT NULL,
                "target_name" varchar(255) NOT NULL DEFAULT '',
                "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "remark" text NOT NULL DEFAULT '',
                "status" varchar(16) NOT NULL DEFAULT 'submitted',
                "score" integer,
                "feedback" text NOT NULL DEFAULT '',
                "reviewed_by_user_id" uuid,
                "submitted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_organization_assignment_submission" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_assignment_submission_student" UNIQUE ("assignment_id", "student_user_id"),
                CONSTRAINT "FK_assignment_submission_assignment" FOREIGN KEY ("assignment_id") REFERENCES "organization_assignment"("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_assignment_submission_assignment" ON "organization_assignment_submission" ("assignment_id")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_assignment_submission_org" ON "organization_assignment_submission" ("organization_id")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_assignment_submission_student" ON "organization_assignment_submission" ("student_user_id")`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "organization_quota" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP WITH TIME ZONE,
                "organization_id" uuid NOT NULL,
                "balance" integer NOT NULL DEFAULT 0,
                "total_granted" integer NOT NULL DEFAULT 0,
                "total_allocated" integer NOT NULL DEFAULT 0,
                CONSTRAINT "PK_organization_quota" PRIMARY KEY ("id"),
                CONSTRAINT "FK_organization_quota_org" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_organization_quota_org" ON "organization_quota" ("organization_id")`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "organization_quota_log" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "organization_id" uuid NOT NULL,
                "target_user_id" uuid,
                "action" varchar(16) NOT NULL,
                "amount" integer NOT NULL,
                "balance_after" integer NOT NULL,
                "operator_user_id" uuid NOT NULL,
                "remark" varchar(200) NOT NULL DEFAULT '',
                CONSTRAINT "PK_organization_quota_log" PRIMARY KEY ("id"),
                CONSTRAINT "FK_organization_quota_log_org" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_organization_quota_log_org" ON "organization_quota_log" ("organization_id")`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_organization_quota_log_target" ON "organization_quota_log" ("target_user_id")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "organization_quota_log"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "organization_quota"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "organization_assignment_submission"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "organization_assignment"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "organization_app_grant"`);
        await queryRunner.query(
            `ALTER TABLE "organization" DROP COLUMN IF EXISTS "app_whitelist_enabled"`,
        );
    }
}
