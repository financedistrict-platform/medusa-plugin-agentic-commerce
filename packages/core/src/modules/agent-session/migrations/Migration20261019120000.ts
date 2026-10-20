import { Migration } from "@mikro-orm/migrations"

export class Migration20261019120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "agent_session" add column if not exists "pending_settlement" jsonb null;`)
    this.addSql(`alter table "agent_session" add column if not exists "agent_webhook_url" text null;`)
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "agent_session" drop column if exists "pending_settlement";`)
    this.addSql(`alter table "agent_session" drop column if exists "agent_webhook_url";`)
  }
}
