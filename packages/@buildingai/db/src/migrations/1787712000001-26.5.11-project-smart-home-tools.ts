import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 26.5.11 - Programming project tools can reference MCP tools or smart-home devices.
 */
export class Migration1787712000001 implements MigrationInterface {
    name = "Migration1787712000001";

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "programming_project_tool"
                ADD COLUMN IF NOT EXISTS "kind" varchar(16) NOT NULL DEFAULT 'mcp',
                ADD COLUMN IF NOT EXISTS "device_id" varchar(255),
                ADD COLUMN IF NOT EXISTS "tool_key" varchar(512)
        `);
        await queryRunner.query(`
            ALTER TABLE "programming_project_tool"
                ALTER COLUMN "mcp_server_id" DROP NOT NULL,
                ALTER COLUMN "tool_name" DROP NOT NULL
        `);
        await queryRunner.query(`
            UPDATE "programming_project_tool"
            SET
                "kind" = COALESCE(NULLIF("kind", ''), 'mcp'),
                "tool_key" = CASE
                    WHEN COALESCE("kind", 'mcp') IN ('xiaomi', 'yeelight')
                        THEN COALESCE("kind", 'xiaomi') || ':' || COALESCE("device_id", '')
                    ELSE 'mcp:' || COALESCE("mcp_server_id", '') || ':' || COALESCE("tool_name", '')
                END
            WHERE "tool_key" IS NULL OR "tool_key" = ''
        `);
        await queryRunner.query(`
            ALTER TABLE "programming_project_tool"
                ALTER COLUMN "tool_key" SET NOT NULL
        `);
        await queryRunner.query(`
            DROP INDEX IF EXISTS "IDX_programming_project_tool_unique"
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "IDX_programming_project_tool_unique"
            ON "programming_project_tool" ("project_id", "tool_key")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DELETE FROM "programming_project_tool"
            WHERE COALESCE("kind", 'mcp') <> 'mcp'
               OR "mcp_server_id" IS NULL
               OR "tool_name" IS NULL
        `);
        await queryRunner.query(`
            DROP INDEX IF EXISTS "IDX_programming_project_tool_unique"
        `);
        await queryRunner.query(`
            ALTER TABLE "programming_project_tool"
                ALTER COLUMN "mcp_server_id" SET NOT NULL,
                ALTER COLUMN "tool_name" SET NOT NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "programming_project_tool"
                DROP COLUMN IF EXISTS "tool_key",
                DROP COLUMN IF EXISTS "device_id",
                DROP COLUMN IF EXISTS "kind"
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "IDX_programming_project_tool_unique"
            ON "programming_project_tool" ("project_id", "mcp_server_id", "tool_name")
        `);
    }
}
