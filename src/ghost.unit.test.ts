import assert from 'assert';
import sinon from 'sinon';
import ky from 'ky';
import { getSiteSettings } from './ghost';
import {
    ACTOR_DEFAULT_ICON,
    ACTOR_DEFAULT_NAME,
    ACTOR_DEFAULT_SUMMARY
} from './constants';

describe('getSiteSettings', function () {
    const host = 'example.com';

    let kyGetStub: sinon.SinonStub;

    beforeEach(function () {
        kyGetStub = sinon.stub(ky, 'get');
    });

    afterEach(function () {
        sinon.restore();
    });

    it('should retrieve settings from Ghost', async function () {
        const settings = {
            site: {
                description: 'foo',
                title: 'bar',
                icon: 'https://example.com/baz.png'
            }
        };

        kyGetStub.returns({
            json: async () => settings
        });

        const result = await getSiteSettings(host);

        assert.deepStrictEqual(result, settings);
        assert.strictEqual(kyGetStub.callCount, 1);
        assert.strictEqual(kyGetStub.firstCall.args[0], `https://${host}/ghost/api/admin/site/`);
    });

    it('should use defaults for missing settings', async function () {
        let result;

        // Missing description
        kyGetStub.returns({
            json: async () => ({
                site: {
                    title: 'bar',
                    icon: 'https://example.com/baz.png'
                }
            })
        });

        result = await getSiteSettings(host);

        assert.deepStrictEqual(result, {
            site: {
                description: ACTOR_DEFAULT_SUMMARY,
                title: 'bar',
                icon: 'https://example.com/baz.png'
            }
        });

        // Missing title
        kyGetStub.returns({
            json: async () => ({
                site: {
                    description: 'foo',
                    icon: 'https://example.com/baz.png'
                }
            })
        });

        result = await getSiteSettings(host);

        assert.deepStrictEqual(result, {
            site: {
                description: 'foo',
                title: ACTOR_DEFAULT_NAME,
                icon: 'https://example.com/baz.png'
            }
        });

        // Missing icon
        kyGetStub.returns({
            json: async () => ({
                site: {
                    description: 'foo',
                    title: 'bar'
                }
            })
        });

        result = await getSiteSettings(host);

        assert.deepStrictEqual(result, {
            site: {
                description: 'foo',
                title: 'bar',
                icon: ACTOR_DEFAULT_ICON
            }
        });

        // Missing everything
        kyGetStub.returns({
            json: async () => ({})
        });

        result = await getSiteSettings(host);

        assert.deepStrictEqual(result, {
            site: {
                description: ACTOR_DEFAULT_SUMMARY,
                title: ACTOR_DEFAULT_NAME,
                icon: ACTOR_DEFAULT_ICON
            }
        });
    });
});
