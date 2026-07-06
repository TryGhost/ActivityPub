import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountService } from '@/account/account.service';
import type { AppContext } from '@/app';
import { NotificationController } from '@/http/api/notification.controller';
import type { NotificationService } from '@/notification/notification.service';

describe('NotificationController', () => {
    let notificationController: NotificationController;
    let notificationService: NotificationService;
    let ctx: AppContext;

    beforeEach(() => {
        notificationService = {
            getNotificationsData: vi.fn().mockResolvedValue({
                results: [
                    {
                        notification_id: 1,
                        notification_created_at: new Date(
                            '2026-07-02T10:00:00Z',
                        ),
                        notification_event_type: '2',
                        actor_id: 123,
                        actor_name: 'Remote Author',
                        actor_username: 'remote',
                        actor_url: 'https://remote.example.com/@remote',
                        actor_webfinger_host: null,
                        actor_avatar_url: '',
                        actor_followed_by_user: 0,
                        post_ap_id: 'https://remote.example.com/posts/1',
                        post_type: '0',
                        post_title: 'Sensitive post',
                        post_summary: null,
                        post_sensitive: 1,
                        post_content_warning: 'Sensitive topic',
                        post_content: 'Post content',
                        post_url: 'https://remote.example.com/posts/1',
                        post_like_count: 0,
                        post_liked_by_user: 0,
                        post_reply_count: 0,
                        post_repost_count: 0,
                        post_reposted_by_user: 0,
                        post_attachments: [],
                        in_reply_to_post_ap_id:
                            'https://remote.example.com/posts/parent',
                        in_reply_to_post_type: '0',
                        in_reply_to_post_title: 'Parent post',
                        in_reply_to_post_summary: null,
                        in_reply_to_post_sensitive: 1,
                        in_reply_to_post_content_warning: 'Parent warning',
                        in_reply_to_post_content: 'Parent content',
                        in_reply_to_post_url:
                            'https://remote.example.com/posts/parent',
                    },
                ],
                nextCursor: null,
            }),
        } as unknown as NotificationService;

        notificationController = new NotificationController(
            {} as AccountService,
            notificationService,
        );

        ctx = {
            req: {
                query: () => null,
            },
            get: (key: string) => {
                if (key === 'account') {
                    return { id: 456 };
                }
            },
        } as unknown as AppContext;
    });

    it('maps sensitive and content warnings for notification post DTOs', async () => {
        const response =
            await notificationController.handleGetNotifications(ctx);

        expect(response.status).toBe(200);
        const body = await response.json();

        expect(body.notifications[0].post).toMatchObject({
            sensitive: true,
            contentWarning: 'Sensitive topic',
        });
        expect(body.notifications[0].inReplyTo).toMatchObject({
            sensitive: true,
            contentWarning: 'Parent warning',
        });
    });
});
