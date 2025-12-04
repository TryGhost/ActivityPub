import type { TopicView } from '@/http/api/views/topic.view';
import { APIRoute, RequireRoles } from '@/http/decorators/route.decorator';
import { GhostRole } from '@/http/middleware/role-guard';

export class TopicController {
    constructor(private readonly topicView: TopicView) {}

    @APIRoute('GET', 'topics')
    @RequireRoles(GhostRole.Owner, GhostRole.Administrator)
    async getTopics() {
        const topics = await this.topicView.getTopics();

        return new Response(
            JSON.stringify({
                topics,
            }),
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                status: 200,
            },
        );
    }
}
