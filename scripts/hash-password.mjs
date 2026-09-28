#!/usr/bin/env node
// アクセスゲート用パスワードの PBKDF2 ハッシュを出力する。
//
//   node scripts/hash-password.mjs 'パスワード'
//   ACCESS_PASSWORD='パスワード' node scripts/hash-password.mjs
//
// 出力値を .env.local の VITE_ACCESS_PW_HASH に設定する。
// パラメータは src/auth/password.ts と一致させること。
import { pbkdf2Sync } from 'node:crypto';

const SALT = 'gtfs-cooker/access-gate/v1';
const ITERATIONS = 310_000;
const KEY_BYTES = 32;

const password = process.env.ACCESS_PASSWORD ?? process.argv[2];

if (!password) {
  console.error('usage: node scripts/hash-password.mjs <password>');
  console.error('   or: ACCESS_PASSWORD=<password> node scripts/hash-password.mjs');
  process.exit(1);
}

console.log(pbkdf2Sync(password, SALT, ITERATIONS, KEY_BYTES, 'sha256').toString('hex'));
