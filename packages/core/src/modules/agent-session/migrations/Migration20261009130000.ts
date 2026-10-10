import { Migration } from "@mikro-orm/migrations"

export class Migration20261009130000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "payment_authorization" ("id" text not null, "asset" text not null, "payer" text not null, "nonce" text not null, "cart_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "payment_authorization_pkey" primary key ("id"));`)
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payment_authorization_asset_payer_nonce_unique" ON "payment_authorization" ("asset", "payer", "nonce");`)
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_payment_authorization_deleted_at" ON "payment_authorization" ("deleted_at") WHERE deleted_at IS NULL;`)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "payment_authorization" cascade;`)
  }
}
