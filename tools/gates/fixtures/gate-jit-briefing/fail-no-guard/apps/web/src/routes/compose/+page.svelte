<!--
	FAIL fixture: a registered compose surface with NO briefing guard at all.
	
	The send here is a plain button with an onclick, which SEND_RE deliberately
	cannot recognise: there is no <form>, no onsubmit, no type="submit". So rule 2
	sees nothing to place, and rule 1 is the only thing that catches this.
	
	That is the point of having rule 1 as well as rule 2. Rule 2 constrains where
	the send affordances it can SEE may appear; rule 1 says a registered surface
	must consult the guard at all, which covers every affordance the pattern list
	will never keep up with.
-->
<script lang="ts">
	async function send() {
		await fetch('/api/aid/need', { method: 'POST' });
	}
</script>

<button onclick={send}>Send</button>
