import Component from '@glimmer/component';
import { inject as service } from '@ember/service';
import { later } from '@ember/runloop';
import { action } from '@ember/object';
import { task } from 'ember-concurrency-decorators';
import { tracked } from '@glimmer/tracking';

/**
 * @module AuthInfo
 *
 * @example
 * ```js
 * <AuthInfo @activeClusterName={{cluster.name}} @onLinkClick={{action "onLinkClick"}} />
 * ```
 *
 * @param {string} activeClusterName - name of the current cluster, passed from the parent.
 * @param {Function} onLinkClick - parent action which determines the behavior on link click
 */

function bufferDecode(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function bufferEncode(value) {
  return btoa(String.fromCharCode.apply(null, new Uint8Array(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

export default class AuthInfoComponent extends Component {
  @service auth;
  @service wizard;
  @service router;

  @tracked fakeRenew = false;

  get hasEntityId() {
    // root users will not have an entity_id because they are not associated with an entity.
    // in order to use the MFA end user setup they need an entity_id
    return !!this.auth.authData.entity_id;
  }

  get isRenewing() {
    return this.fakeRenew || this.auth.isRenewing;
  }

  transitionToRoute() {
    this.router.transitionTo(...arguments);
  }

  @action
  restartGuide() {
    this.wizard.restartGuide();
  }

  @action
  renewToken() {
    this.fakeRenew = true;
    later(() => {
      this.auth.renew().then(() => {
        this.fakeRenew = this.auth.isRenewing;
      });
    }, 200);
  }

  @action
  revokeToken() {
    this.auth.revokeCurrentToken().then(() => {
      this.transitionToRoute('vault.cluster.logout');
    });
  }

  @task
  *registerWebauthn() {
    // figure out how to get a username
    const username = yield prompt('Username:');

    yield fetch('http://127.0.0.1:8200/v1/auth/webauthn/register/begin', {
      method: 'POST',
      body: JSON.stringify({ user: username }),
    })
      .then((res) => res.json())
      .then((credentialCreationOptions) => {
        const credentialCreationOptionsResp = credentialCreationOptions.data;
        credentialCreationOptionsResp.publicKey.challenge = bufferDecode(
          credentialCreationOptionsResp.publicKey.challenge
        );
        credentialCreationOptionsResp.publicKey.user.id = bufferDecode(
          credentialCreationOptionsResp.publicKey.user.id
        );

        if (credentialCreationOptionsResp.publicKey.excludeCredentials) {
          for (var i = 0; i < credentialCreationOptionsResp.publicKey.excludeCredentials.length; i++) {
            credentialCreationOptionsResp.publicKey.excludeCredentials[i].id = bufferDecode(
              credentialCreationOptionsResp.publicKey.excludeCredentials[i].id
            );
          }
        }

        return navigator.credentials.create({
          publicKey: credentialCreationOptionsResp.publicKey,
        });
      })
      .then((credential) => {
        let attestationObject = credential.response.attestationObject;
        let clientDataJSON = credential.response.clientDataJSON;
        let rawId = credential.rawId;

        return fetch(`/register/finish/${username}`, {
          method: 'POST',
          body: JSON.stringify({
            id: credential.id,
            rawId: bufferEncode(rawId),
            type: credential.type,
            response: {
              attestationObject: bufferEncode(attestationObject),
              clientDataJSON: bufferEncode(clientDataJSON),
            },
          }),
        });
      })
      .then((res) => res.json())
      .then(() => alert(`successfully registered ${username}!`))
      .catch((error) => {
        console.log(error);
        alert(`failed to register ${username}`);
      });
  }
}
