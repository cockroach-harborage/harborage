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
import { handleBatch, type RecordedIncident, type RecordedKeyring } from './handler.ts';
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

					async recordKeyring(ring: RecordedKeyring): Promise<void> {
						// The blob is stored verbatim and never opened. This Worker holds
						// INTAKE_PRIVATE_KEY, which opens the incident metadata envelope
						// and nothing else; no key here can open a keyring copy, which is
						// what makes the SEALED-E2E claim on the evidence original true.
						//
						// DO NOTHING on conflict: a keyring is keyed on the pristine
						// original's digest, and overwriting one would be a way to swap
						// whose keys can open an existing file.
						await env.DB.prepare(
							`INSERT INTO evidence_keyrings
								(original_sha256, tier, keyring, copy_count, created_bucket)
							 VALUES (?1, ?2, ?3, ?4, ?5)
							 ON CONFLICT(original_sha256) DO NOTHING`
						)
							.bind(
								ring.originalSha256,
								ring.tier,
								ring.keyring,
								ring.copyCount,
								ring.createdBucket
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
