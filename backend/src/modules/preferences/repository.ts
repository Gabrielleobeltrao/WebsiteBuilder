import { DEFAULT_APP_LOCALE, type SupportedAppLocale } from "@websitebuilder/shared";
import type { Collection, Db } from "mongodb";

import { COLLECTIONS } from "../../db/indexes";

/**
 * User-level preferences, deliberately outside workspace ownership.
 *
 * The interface language follows the person, not the tenant: switching from an agency workspace to
 * a personal one must not change the language they read the product in. Keyed by the Better Auth
 * user ID, which is globally unique.
 */
type PreferencesDocument = { userId: string; locale: SupportedAppLocale; createdAt: string; updatedAt: string };

export class PreferencesRepository {
  private readonly collection: Collection<PreferencesDocument>;

  constructor(db: Db) {
    this.collection = db.collection<PreferencesDocument>(COLLECTIONS.userPreferences);
  }

  async find(userId: string): Promise<{ locale: SupportedAppLocale } | null> {
    const document = await this.collection.findOne({ userId }, { projection: { locale: 1 } });
    return document === null ? null : { locale: document.locale };
  }

  async save(userId: string, locale: SupportedAppLocale): Promise<{ locale: SupportedAppLocale }> {
    const now = new Date().toISOString();
    await this.collection.updateOne(
      { userId },
      { $set: { locale, updatedAt: now }, $setOnInsert: { userId, createdAt: now } },
      { upsert: true },
    );
    return { locale };
  }

  /**
   * Writes a starting preference only when the account has none.
   *
   * Idempotent on purpose: a later sign-in must never overwrite a choice the user made, merely
   * because their browser language changed.
   */
  async seedIfAbsent(userId: string, locale: SupportedAppLocale): Promise<{ locale: SupportedAppLocale }> {
    const existing = await this.find(userId);
    if (existing !== null) return existing;
    return this.save(userId, locale);
  }

  async resolve(userId: string): Promise<SupportedAppLocale> {
    return (await this.find(userId))?.locale ?? DEFAULT_APP_LOCALE;
  }
}
