/**
 * workers/consumer entry (manifest §18.3). The only file that imports
 * Workers-only modules, so handler.ts and tier0.ts stay testable in plain Node.
 *
 * No fetch handler and no route: this Worker is reachable only through the
 * queue. There is no HTTP surface to attack, nothing to rate-limit, and no way
 * to reach it without first clearing everything guarding the api Worker.
 *
 * First writer of the `incidents` table.
 */
import { handleBatch, type RecordedIncident } from './handler.ts';
import { safeLog } from '@harborage/worker-lib/safe-log';
import type { Observations } from '@harborage/worker-lib/verification';
import type { ConsumerEnv } from '@harborage/worker-lib/types';

interface VerificationStateStub {
	apply(itemId: string, observations: Observations, actorClass?: 'auto' | 'human'): Promise<unknown>;
}

export default {
	async queue(batch: MessageBatch<unknown>, env: ConsumerEnv): Promise<void> {
		const outcomes = await handleBatch(
			batch as unknown as Parameters<typeof handleBatch>[0],
			{
				rulesets: env.RULESETS,
				intakePrivateKey: env.INTAKE_PRIVATE_KEY,
				now: () => Date.now(),

				async recordIncident(incident: RecordedIncident): Promise<void> {
					// Admitted rows start at status PENDING, never PUBLIC. Only the Cron
					// materializer moves anything to the public index, and only from
					// Human-Verified or Community-Corroborated — neither of which is
					// reachable autonomously.
					await env.DB.prepare(
						`INSERT INTO incidents
							(id, type, occurred_date, region_bucket, narrative,
							 verification_state, corroboration_count, status)
						 VALUES (?1, ?2, ?3, ?4, ?5, 'Unverified', 0, 'PENDING')
						 ON CONFLICT(id) DO NOTHING`
					)
						.bind(
							incident.id,
							incident.type,
							incident.occurredDate,
							incident.regionBucket,
							incident.narrative
						)
						.run();
				},

				async applyVerification(itemId: string, observations: Observations): Promise<void> {
					const ns = env.VERIFICATION_STATE;
					const stub = ns.get(ns.idFromName(itemId)) as unknown as VerificationStateStub;
					await stub.apply(itemId, observations, 'auto');
				}
			}
		);

		safeLog('queue_batch', {
			queue: 'moderation-bulk',
			count: outcomes.length,
			outcome: outcomes.every((o) => o.disposition === 'ack') ? 'all_acked' : 'some_retried'
		});
	}
};
