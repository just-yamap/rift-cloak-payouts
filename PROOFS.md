# On-chain Proofs - Solana Mainnet

All transactions submitted from operator wallet:
`33oX24NFJHnTaGctA6g8mU42oR2MYGWKBJSmGzsgjoRn`

Cloak program: `zh1eLd6rSphLejbFfJEneUwzHRfMKxgzrgkfwA6qRkW`
Cloak relay: `https://api.cloak.ag`
USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

---

## Transaction 1 - Shield (operator deposits treasury)

**Action**: 0.5 USDC moved from operator's public ATA into the Cloak shielded pool.

- **Signature**: `NqU9eJ6QWZH1ydqtwLrCYESV7DL8D18raRS8uzQxuAtg9jXkQ3gQ6QCWiQbCaRuXGXY9qQd1HFQatqU5Twz8uu5`
- **Slot**: 418952017
- **Explorer**: https://explorer.solana.com/tx/NqU9eJ6QWZH1ydqtwLrCYESV7DL8D18raRS8uzQxuAtg9jXkQ3gQ6QCWiQbCaRuXGXY9qQd1HFQatqU5Twz8uu5

This TX is publicly visible - observers see the operator deposited 0.5 USDC.

---

## Transaction 2 - Shielded Transfer (operator → vendor, PRIVATE)

**Action**: 0.3 USDC sent privately from operator's UTXO to a vendor's UTXO,
entirely within the Cloak pool. The amount and recipient are cryptographically
hidden - observers see only that a transfer happened.

- **Signature**: `2utf1N1rSM1YmqHP8a96C7kP3HMpjZA3PTqpShQXCziBhnPXC5Lm5DTw6q2WRHyqQNh9PEZpFqmC1wWPcPSmSazx`
- **Slot**: 418955174
- **Explorer**: https://explorer.solana.com/tx/2utf1N1rSM1YmqHP8a96C7kP3HMpjZA3PTqpShQXCziBhnPXC5Lm5DTw6q2WRHyqQNh9PEZpFqmC1wWPcPSmSazx

This is the privacy-bearing step. Anyone watching the chain cannot determine:
- How much was sent
- Who received it
- Whether it relates to the shield TX above

---

## Transaction 3 - Withdraw (vendor → public address)

**Action**: The vendor withdraws their 0.3 USDC from the Cloak pool to a public
Solana address. The recipient address is publicly visible, but the link back to
the operator's shield TX is broken.

- **Signature**: `4GdhMrDvDGdLMpGFAKqJU7AHKLYAo9NqHQ5y3fvdhbShJiFMgyEbWsbxmQS3w3znVyUgDrTFsDrS8f2EDwR8a5ng`
- **Slot**: 418955851
- **Explorer**: https://explorer.solana.com/tx/4GdhMrDvDGdLMpGFAKqJU7AHKLYAo9NqHQ5y3fvdhbShJiFMgyEbWsbxmQS3w3znVyUgDrTFsDrS8f2EDwR8a5ng

---

## Privacy Guarantee Summary

| Observable | Without Cloak | With Cloak |
|---|---|---|
| Operator's outflow amount | Visible (0.3 USDC) | Pool-level only (0.5 in, 0.3 out - could be anyone's) |
| Vendor's identity | Visible | Hidden - no link to operator |
| Payment cadence | Indexed | Unobservable |
| Compliance audit | Public records | Viewing-key controlled (selective disclosure) |

## Treasury Reconciliation (self-audit)

- Shielded:    0.5 USDC
- Sent to vendor: 0.3 USDC
- Operator change in pool: 0.2 USDC
- Vendor withdrew: 0.3 USDC ✓

All amounts accounted for. No funds lost or unattributed.
