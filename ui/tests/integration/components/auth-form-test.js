import { later, _cancelTimers as cancelTimers } from '@ember/runloop';
import EmberObject from '@ember/object';
import { resolve } from 'rsvp';
import Service from '@ember/service';
import { module, test } from 'qunit';
import { setupRenderingTest } from 'ember-qunit';
import { render, settled } from '@ember/test-helpers';
import hbs from 'htmlbars-inline-precompile';
import sinon from 'sinon';
import Pretender from 'pretender';
import { create } from 'ember-cli-page-object';
import authForm from '../../pages/components/auth-form';

const component = create(authForm);

const workingAuthService = Service.extend({
  authenticate() {
    return resolve({});
  },
  handleError() {},
  setLastFetch() {},
});

const routerService = Service.extend({
  transitionTo() {
    return {
      followRedirects() {
        return resolve();
      },
    };
  },
});

module('Integration | Component | auth form', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function () {
    this.owner.register('service:router', routerService);
    this.router = this.owner.lookup('service:router');
  });

  const CSP_ERR_TEXT = `Error This is a standby Vault node but can't communicate with the active node via request forwarding. Sign in at the active node to use the Vault UI.`;
  test('it renders error on CSP violation', async function (assert) {
    assert.expect(2);
    this.set('cluster', EmberObject.create({ standby: true }));
    this.set('selectedAuth', 'token');
    await render(hbs`{{auth-form cluster=this.cluster selectedAuth=this.selectedAuth}}`);
    assert.false(component.errorMessagePresent, false);
    this.owner.lookup('service:csp-event').events.addObject({ violatedDirective: 'connect-src' });
    await settled();
    assert.strictEqual(component.errorText, CSP_ERR_TEXT);
  });

  test('it renders with vault style errors', async function (assert) {
    assert.expect(1);
    let server = new Pretender(function () {
      this.get('/v1/auth/**', () => {
        return [
          400,
          { 'Content-Type': 'application/json' },
          JSON.stringify({
            errors: ['Not allowed'],
          }),
        ];
      });
      this.get('/v1/sys/internal/ui/mounts', this.passthrough);
    });

    this.set('cluster', EmberObject.create({}));
    this.set('selectedAuth', 'token');
    await render(hbs`{{auth-form cluster=this.cluster selectedAuth=this.selectedAuth}}`);
    return component.login().then(() => {
      assert.strictEqual(component.errorText, 'Error Authentication failed: Not allowed');
      server.shutdown();
    });
  });

  test('it renders AdapterError style errors', async function (assert) {
    assert.expect(1);
    let server = new Pretender(function () {
      this.get('/v1/auth/**', () => {
        return [400, { 'Content-Type': 'application/json' }];
      });
      this.get('/v1/sys/internal/ui/mounts', this.passthrough);
    });

    this.set('cluster', EmberObject.create({}));
    this.set('selectedAuth', 'token');
    await render(hbs`{{auth-form cluster=this.cluster selectedAuth=this.selectedAuth}}`);
    // ARG TODO research and see if adapter errors changed, but null used to be Bad Request
    return component.login().then(() => {
      assert.strictEqual(component.errorText, 'Error Authentication failed: null');
      server.shutdown();
    });
  });

  test('it renders no tabs when no methods are passed', async function (assert) {
    let methods = {
      'approle/': {
        type: 'approle',
      },
    };
    let server = new Pretender(function () {
      this.get('/v1/sys/internal/ui/mounts', () => {
        return [200, { 'Content-Type': 'application/json' }, JSON.stringify({ data: { auth: methods } })];
      });
    });
    await render(hbs`<AuthForm @cluster={{this.cluster}} />`);

    assert.strictEqual(component.tabs.length, 0, 'renders a tab for every backend');
    server.shutdown();
  });

  test('it renders all the supported methods and Other tab when methods are present', async function (assert) {
    let methods = {
      'foo/': {
        type: 'userpass',
      },
      'approle/': {
        type: 'approle',
      },
    };
    let server = new Pretender(function () {
      this.get('/v1/sys/internal/ui/mounts', () => {
        return [200, { 'Content-Type': 'application/json' }, JSON.stringify({ data: { auth: methods } })];
      });
    });

    this.set('cluster', EmberObject.create({}));
    await render(hbs`{{auth-form cluster=this.cluster }}`);

    assert.strictEqual(component.tabs.length, 2, 'renders a tab for userpass and Other');
    assert.strictEqual(component.tabs.objectAt(0).name, 'foo', 'uses the path in the label');
    assert.strictEqual(component.tabs.objectAt(1).name, 'Other', 'second tab is the Other tab');
    server.shutdown();
  });

  test('it renders the description', async function (assert) {
    let methods = {
      'approle/': {
        type: 'userpass',
        description: 'app description',
      },
    };
    let server = new Pretender(function () {
      this.get('/v1/sys/internal/ui/mounts', () => {
        return [200, { 'Content-Type': 'application/json' }, JSON.stringify({ data: { auth: methods } })];
      });
    });
    this.set('cluster', EmberObject.create({}));
    await render(hbs`{{auth-form cluster=this.cluster }}`);

    assert.strictEqual(
      component.descriptionText,
      'app description',
      'renders a description for auth methods'
    );
    server.shutdown();
  });

  test('it calls authenticate with the correct path', async function (assert) {
    this.owner.unregister('service:auth');
    this.owner.register('service:auth', workingAuthService);
    this.auth = this.owner.lookup('service:auth');
    let authSpy = sinon.spy(this.auth, 'authenticate');
    let methods = {
      'foo/': {
        type: 'userpass',
      },
    };
    let server = new Pretender(function () {
      this.get('/v1/sys/internal/ui/mounts', () => {
        return [200, { 'Content-Type': 'application/json' }, JSON.stringify({ data: { auth: methods } })];
      });
    });

    this.set('cluster', EmberObject.create({}));
    this.set('selectedAuth', 'foo/');
    await render(hbs`{{auth-form cluster=this.cluster selectedAuth=this.selectedAuth}}`);
    await component.login();

    await settled();
    assert.ok(authSpy.calledOnce, 'a call to authenticate was made');
    let { data } = authSpy.getCall(0).args[0];
    assert.strictEqual(data.path, 'foo', 'uses the id for the path');
    authSpy.restore();
    server.shutdown();
  });

  test('it renders no tabs when no supported methods are present in passed methods', async function (assert) {
    let methods = {
      'approle/': {
        type: 'approle',
      },
    };
    let server = new Pretender(function () {
      this.get('/v1/sys/internal/ui/mounts', () => {
        return [200, { 'Content-Type': 'application/json' }, JSON.stringify({ data: { auth: methods } })];
      });
    });
    this.set('cluster', EmberObject.create({}));
    await render(hbs`<AuthForm @cluster={{this.cluster}} />`);

    server.shutdown();
    assert.strictEqual(component.tabs.length, 0, 'renders a tab for every backend');
  });

  test('it makes a request to unwrap if passed a wrappedToken and logs in', async function (assert) {
    this.owner.register('service:auth', workingAuthService);
    this.auth = this.owner.lookup('service:auth');
    let authSpy = sinon.spy(this.auth, 'authenticate');
    let server = new Pretender(function () {
      this.post('/v1/sys/wrapping/unwrap', () => {
        return [
          200,
          { 'content-type': 'application/json' },
          JSON.stringify({
            auth: {
              client_token: '12345',
            },
          }),
        ];
      });
    });

    let wrappedToken = '54321';
    this.set('wrappedToken', wrappedToken);
    this.set('cluster', EmberObject.create({}));
    await render(hbs`<AuthForm @cluster={{this.cluster}} @wrappedToken={{this.wrappedToken}} />`);
    later(() => cancelTimers(), 50);
    await settled();
    assert.strictEqual(
      server.handledRequests[0].url,
      '/v1/sys/wrapping/unwrap',
      'makes call to unwrap the token'
    );
    assert.strictEqual(
      server.handledRequests[0].requestHeaders['X-Vault-Token'],
      wrappedToken,
      'uses passed wrapped token for the unwrap'
    );
    assert.ok(authSpy.calledOnce, 'a call to authenticate was made');
    server.shutdown();
    authSpy.restore();
  });

  test('it shows an error if unwrap errors', async function (assert) {
    let server = new Pretender(function () {
      this.post('/v1/sys/wrapping/unwrap', () => {
        return [
          400,
          { 'Content-Type': 'application/json' },
          JSON.stringify({
            errors: ['There was an error unwrapping!'],
          }),
        ];
      });
    });

    this.set('wrappedToken', '54321');
    await render(hbs`{{auth-form cluster=this.cluster wrappedToken=this.wrappedToken}}`);
    later(() => cancelTimers(), 50);

    await settled();
    assert.strictEqual(
      component.errorText,
      'Error Token unwrap failed: There was an error unwrapping!',
      'shows the error'
    );
    server.shutdown();
  });
});
