import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 26.5.14 — Re-issue Yeelight Pro tables.
 *
 * 26.5.10 shipped two migrations with the same TypeORM name
 * (`Migration1787625600000`). The repair-legacy-schema file ran; the Yeelight
 * tables were recorded as already applied and never created.
 */
export class Migration1787972800000 implements MigrationInterface {
    name = "Migration1787972800000";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "yeelight_pro_account" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP WITH TIME ZONE,
                "owner_user_id" uuid NOT NULL,
                "label" varchar(80) NOT NULL DEFAULT '易来账号',
                "region" varchar(8) NOT NULL DEFAULT 'cn',
                "upstream_user_id" varchar(64),
                "username" varchar(120),
                "house_id" varchar(80),
                "house_name" varchar(120),
                "scan_device" varchar(80) NOT NULL,
                "client_id_encrypted" text,
                "client_secret_encrypted" text,
                "access_token_encrypted" text NOT NULL,
                "refresh_token_encrypted" text NOT NULL,
                "access_token_expires_at" TIMESTAMP WITH TIME ZONE,
                "status" varchar(16) NOT NULL DEFAULT 'active',
                "homes" jsonb NOT NULL DEFAULT '[]'::jsonb,
                "last_sync_at" TIMESTAMP WITH TIME ZONE,
                "last_error" text,
                CONSTRAINT "PK_yeelight_pro_account" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_yeelight_pro_account_owner_upstream_region"
                    UNIQUE ("owner_user_id", "upstream_user_id", "region")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_yeelight_pro_account_owner"
            ON "yeelight_pro_account" ("owner_user_id")
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_yeelight_pro_account_upstream_user"
            ON "yeelight_pro_account" ("upstream_user_id")
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "yeelight_pro_qr_session" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP WITH TIME ZONE,
                "owner_user_id" uuid NOT NULL,
                "region" varchar(8) NOT NULL DEFAULT 'cn',
                "scan_device" varchar(80) NOT NULL,
                "qr_code_id" varchar(160) NOT NULL,
                "qrcode_content" varchar(240) NOT NULL,
                "status" varchar(16) NOT NULL DEFAULT 'CREATED',
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "consumed_at" TIMESTAMP WITH TIME ZONE,
                "account_id" uuid,
                CONSTRAINT "PK_yeelight_pro_qr_session" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_yeelight_pro_qr_session_code" UNIQUE ("qr_code_id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_yeelight_pro_qr_session_owner"
            ON "yeelight_pro_qr_session" ("owner_user_id")
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "yeelight_pro_device" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "deleted_at" TIMESTAMP WITH TIME ZONE,
                "account_id" uuid NOT NULL,
                "did" varchar(80) NOT NULL,
                "house_id" varchar(80),
                "house_name" varchar(120),
                "room_id" varchar(80),
                "room_name" varchar(120),
                "name" varchar(160) NOT NULL,
                "model" varchar(160),
                "product_id" integer,
                "icon" text,
                "category" varchar(32) NOT NULL DEFAULT 'other',
                "online" boolean NOT NULL DEFAULT false,
                "capabilities" jsonb NOT NULL DEFAULT '[]'::jsonb,
                "state" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
                "last_state_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_yeelight_pro_device" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_yeelight_pro_device_account_did" UNIQUE ("account_id", "did")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_yeelight_pro_device_account"
            ON "yeelight_pro_device" ("account_id")
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_yeelight_pro_device_did"
            ON "yeelight_pro_device" ("did")
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_yeelight_pro_device_house"
            ON "yeelight_pro_device" ("house_id")
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_yeelight_pro_device_room"
            ON "yeelight_pro_device" ("room_id")
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_yeelight_pro_device_category"
            ON "yeelight_pro_device" ("category")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "yeelight_pro_device"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "yeelight_pro_qr_session"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "yeelight_pro_account"`);
    }
}
