import { vi } from 'vitest';

/**
 * Mock for FedifyContext.getObjectUri that derives stable
 * `https://example.com/<type>/<id>` URLs from the object class
 */
export function mockGetObjectUri() {
    return vi
        .fn()
        .mockImplementation(
            (object: { name: string }, { id }: { id: string }) =>
                new URL(
                    `https://example.com/${object.name.toLowerCase()}/${id}`,
                ),
        );
}
