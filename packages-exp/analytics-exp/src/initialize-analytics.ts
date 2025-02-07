/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { DynamicConfig, Gtag, MinimalDynamicConfig } from './types';
import { GtagCommand, GA_FID_KEY, ORIGIN_KEY } from './constants';
import { _FirebaseInstallationsInternal } from '@firebase/installations-exp';
import { fetchDynamicConfigWithRetry } from './get-config';
import { logger } from './logger';
import { FirebaseApp } from '@firebase/app-exp';
import {
  isIndexedDBAvailable,
  validateIndexedDBOpenable
} from '@firebase/util';
import { ERROR_FACTORY, AnalyticsError } from './errors';
import { findGtagScriptOnPage, insertScriptTag } from './helpers';
import { AnalyticsSettings } from './public-types';

async function validateIndexedDB(): Promise<boolean> {
  if (!isIndexedDBAvailable()) {
    logger.warn(
      ERROR_FACTORY.create(AnalyticsError.INDEXEDDB_UNAVAILABLE, {
        errorInfo: 'IndexedDB is not available in this environment.'
      }).message
    );
    return false;
  } else {
    try {
      await validateIndexedDBOpenable();
    } catch (e) {
      logger.warn(
        ERROR_FACTORY.create(AnalyticsError.INDEXEDDB_UNAVAILABLE, {
          errorInfo: e
        }).message
      );
      return false;
    }
  }
  return true;
}

/**
 * Initialize the analytics instance in gtag.js by calling config command with fid.
 *
 * NOTE: We combine analytics initialization and setting fid together because we want fid to be
 * part of the `page_view` event that's sent during the initialization
 * @param app Firebase app
 * @param gtagCore The gtag function that's not wrapped.
 * @param dynamicConfigPromisesList Array of all dynamic config promises.
 * @param measurementIdToAppId Maps measurementID to appID.
 * @param installations _FirebaseInstallationsInternal instance.
 *
 * @returns Measurement ID.
 */
export async function initializeAnalytics(
  app: FirebaseApp,
  dynamicConfigPromisesList: Array<
    Promise<DynamicConfig | MinimalDynamicConfig>
  >,
  measurementIdToAppId: { [key: string]: string },
  installations: _FirebaseInstallationsInternal,
  gtagCore: Gtag,
  dataLayerName: string,
  options?: AnalyticsSettings
): Promise<string> {
  const dynamicConfigPromise = fetchDynamicConfigWithRetry(app);
  // Once fetched, map measurementIds to appId, for ease of lookup in wrapped gtag function.
  dynamicConfigPromise
    .then(config => {
      measurementIdToAppId[config.measurementId] = config.appId;
      if (
        app.options.measurementId &&
        config.measurementId !== app.options.measurementId
      ) {
        logger.warn(
          `The measurement ID in the local Firebase config (${app.options.measurementId})` +
            ` does not match the measurement ID fetched from the server (${config.measurementId}).` +
            ` To ensure analytics events are always sent to the correct Analytics property,` +
            ` update the` +
            ` measurement ID field in the local config or remove it from the local config.`
        );
      }
    })
    .catch(e => logger.error(e));
  // Add to list to track state of all dynamic config promises.
  dynamicConfigPromisesList.push(dynamicConfigPromise);

  const fidPromise: Promise<string | undefined> = validateIndexedDB().then(
    envIsValid => {
      if (envIsValid) {
        return installations.getId();
      } else {
        return undefined;
      }
    }
  );

  const [dynamicConfig, fid] = await Promise.all([
    dynamicConfigPromise,
    fidPromise
  ]);

  // Detect if user has already put the gtag <script> tag on this page.
  if (!findGtagScriptOnPage()) {
    insertScriptTag(dataLayerName, dynamicConfig.measurementId);
  }

  // This command initializes gtag.js and only needs to be called once for the entire web app,
  // but since it is idempotent, we can call it multiple times.
  // We keep it together with other initialization logic for better code structure.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (gtagCore as any)('js', new Date());
  // User config added first. We don't want users to accidentally overwrite
  // base Firebase config properties.
  const configProperties: Record<string, unknown> = options?.config ?? {};

  // guard against developers accidentally setting properties with prefix `firebase_`
  configProperties[ORIGIN_KEY] = 'firebase';
  configProperties.update = true;

  if (fid != null) {
    configProperties[GA_FID_KEY] = fid;
  }

  // It should be the first config command called on this GA-ID
  // Initialize this GA-ID and set FID on it using the gtag config API.
  // Note: This will trigger a page_view event unless 'send_page_view' is set to false in
  // `configProperties`.
  gtagCore(GtagCommand.CONFIG, dynamicConfig.measurementId, configProperties);
  return dynamicConfig.measurementId;
}
