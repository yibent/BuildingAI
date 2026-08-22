import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 26.5.14 — Replace Xiaomi/Yeelight cloud adapters with Home Assistant.
 */
export class Migration1787972800000 implements MigrationInterface {
    name = "Migration1787972800000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "home_assistant_instance" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP WITH TIME ZONE,
                "owner_user_id" uuid NOT NULL,
                "label" varchar(80) NOT NULL DEFAULT 'Home Assistant',
                "base_url" text NOT NULL,
                "auth_mode" varchar(16) NOT NULL DEFAULT 'token',
                "username" varchar(120),
                "access_token_encrypted" text NOT NULL,
                "refresh_token_encrypted" text,
                "access_token_expires_at" TIMESTAMP WITH TIME ZONE,
                "ha_version" varchar(40),
                "location_name" varchar(120),
                "status" varchar(16) NOT NULL DEFAULT 'active',
                "last_sync_at" TIMESTAMP WITH TIME ZONE,
                "last_error" text,
                CONSTRAINT "PK_home_assistant_instance" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_home_assistant_instance_owner" UNIQUE ("owner_user_id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_home_assistant_instance_owner"
            ON "home_assistant_instance" ("owner_user_id")
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "home_assistant_device" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP WITH TIME ZONE,
                "instance_id" uuid NOT NULL,
                "entity_id" varchar(255) NOT NULL,
                "unique_id" varchar(255),
                "name" varchar(160) NOT NULL,
                "domain" varchar(32) NOT NULL,
                "category" varchar(32) NOT NULL DEFAULT 'other',
                "area_id" varchar(80),
                "area_name" varchar(120),
                "online" boolean NOT NULL DEFAULT false,
                "state" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "attributes" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "last_state_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_home_assistant_device" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_home_assistant_device_instance_entity"
                    UNIQUE ("instance_id", "entity_id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_home_assistant_device_instance"
            ON "home_assistant_device" ("instance_id")
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_home_assistant_device_domain"
            ON "home_assistant_device" ("domain")
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_home_assistant_device_category"
            ON "home_assistant_device" ("category")
        `);

        await queryRunner.query(`
            DELETE FROM "programming_project_tool"
            WHERE "kind" IN ('xiaomi', 'yeelight')
        `);

        await queryRunner.query(`DROP TABLE IF EXISTS "xiaomi_home_device" CASCADE`);
        await queryRunner.query(`DROP TABLE IF EXISTS "xiaomi_home_oauth_session" CASCADE`);
        await queryRunner.query(`DROP TABLE IF EXISTS "xiaomi_home_account" CASCADE`);
        await queryRunner.query(`DROP TABLE IF EXISTS "yeelight_pro_device" CASCADE`);
        await queryRunner.query(`DROP TABLE IF EXISTS "yeelight_pro_qr_session" CASCADE`);
        await queryRunner.query(`DROP TABLE IF EXISTS "yeelight_pro_account" CASCADE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "home_assistant_device"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "home_assistant_instance"`);
    }
}
