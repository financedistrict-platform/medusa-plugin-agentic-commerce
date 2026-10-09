import { Migration } from "@mikro-orm/migrations"

export class Migration20261009120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "agent_session" ("id" text not null, "cart_id" text not null, "session_fingerprint" text not null, "ucp_version" text null, "canceled_at" timestamptz null, "handler_data" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "agent_session_pkey" primary key ("id"));`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_agent_session_cart_id_unique" ON "agent_session" ("cart_id") WHERE deleted_at IS NULL;`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_agent_session_deleted_at" ON "agent_session" ("deleted_at") WHERE deleted_at IS NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "agent_session" cascade;`)
  }
}
