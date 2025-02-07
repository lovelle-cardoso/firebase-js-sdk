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

import firebase from '@firebase/app';
import { FirebaseNamespace } from '@firebase/app-types';

import { Firestore, MemoryPersistenceProvider, ExpFirestore } from './export';
import { name, version } from './package.json';
import { configureForFirebase } from './src/config';

import './register-module';

/**
 * Registers the memory-only Firestore build for ReactNative with the components
 * framework.
 */
export function registerFirestore(instance: FirebaseNamespace): void {
  configureForFirebase(
    instance,
    (app, auth) =>
      new Firestore(
        app,
        new ExpFirestore(app, auth),
        new MemoryPersistenceProvider()
      )
  );
  instance.registerVersion(name, version, 'rn');
}

registerFirestore(firebase);
