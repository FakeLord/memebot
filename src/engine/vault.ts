import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateSealKeys, importPrivateKey } from '../shared/seal'
import type { GmgnPlan } from '../shared/engine'

// Motorun kasası: kullanıcıların GMGN / XFlux / Telegram sırları ve mühürlü zarf anahtar çifti.
// Diskte tek dosya, AES-256-GCM ile ana anahtarla (ENGINE_MASTER_KEY) şifreli. Bilgisayarda ana anahtar
// masaüstü uygulamasında Windows şifrelemesiyle, VPS'te sunucunun .env dosyasında durur.

export interface GmgnSecret {
  apiKey: string
  privateKeyPem: string
  plan?: GmgnPlan
  wallet?: string // API anahtarına bağlı, işlem yapılacak SOL cüzdanı
}

export interface TelegramSecret {
  apiId: number
  apiHash: string
  session: string
}

export interface UserSecrets {
  gmgn?: GmgnSecret
  xflux?: { apiKey: string }
  telegram?: TelegramSecret
}

interface VaultData {
  v: 1
  seal: { publicJwk: JsonWebKey; privateJwk: JsonWebKey }
  users: Record<string, UserSecrets>
}

const USER_ID = /^[0-9a-f-]{36}$/i

export class Vault {
  private data!: VaultData
  private privateKey!: CryptoKey
  private readonly file: string

  private constructor(
    dir: string,
    private readonly key: Buffer
  ) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'vault.bin')
  }

  static async open(dir: string, masterKeyB64: string): Promise<Vault> {
    const key = Buffer.from(masterKeyB64, 'base64')
    if (key.length !== 32) throw new Error('ENGINE_MASTER_KEY 32 baytlık base64 olmalı')
    const v = new Vault(dir, key)
    if (existsSync(v.file)) {
      v.data = v.decrypt(readFileSync(v.file))
    } else {
      v.data = { v: 1, seal: await generateSealKeys(), users: {} }
      v.persist()
    }
    v.privateKey = await importPrivateKey(v.data.seal.privateJwk)
    return v
  }

  get publicJwk(): JsonWebKey {
    return this.data.seal.publicJwk
  }

  get sealKey(): CryptoKey {
    return this.privateKey
  }

  get(userId: string): UserSecrets {
    return this.data.users[userId] ?? {}
  }

  userIds(): string[] {
    return Object.keys(this.data.users)
  }

  set<K extends keyof UserSecrets>(userId: string, kind: K, value: UserSecrets[K] | undefined): void {
    if (!USER_ID.test(userId)) throw new Error('Geçersiz kullanıcı kimliği')
    const u = { ...this.get(userId) }
    if (value === undefined) delete u[kind]
    else u[kind] = value
    this.data.users[userId] = u
    this.persist()
  }

  private persist(): void {
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', this.key, iv)
    const body = Buffer.concat([c.update(JSON.stringify(this.data), 'utf-8'), c.final()])
    // Yarım yazılmış dosya kalmasın: önce geçici dosyaya yaz, sonra yerine taşı
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, Buffer.concat([iv, c.getAuthTag(), body]), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  private decrypt(buf: Buffer): VaultData {
    const d = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12))
    d.setAuthTag(buf.subarray(12, 28))
    try {
      return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf-8')) as VaultData
    } catch {
      throw new Error('Kasa açılamadı: ENGINE_MASTER_KEY yanlış ya da dosya bozuk')
    }
  }
}
