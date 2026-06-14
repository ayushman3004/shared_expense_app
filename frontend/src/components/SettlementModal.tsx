import { useState, useEffect } from 'react';
import { api } from '../utils/api';

interface SettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  groupId: string;
  groupMembers: any[];
  settlement?: any;
}

export default function SettlementModal({ isOpen, onClose, onSuccess, groupId, groupMembers, settlement }: SettlementModalProps) {
  const [fromUserId, setFromUserId] = useState('');
  const [toUserId, setToUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (settlement) {
      setFromUserId(settlement.fromUserId || settlement.fromUser.id);
      setToUserId(settlement.toUserId || settlement.toUser.id);
      setAmount(String(settlement.amount));
      setDate(new Date(settlement.date).toISOString().slice(0, 10));
      setNotes(settlement.notes || '');
    } else {
      setFromUserId('');
      setToUserId('');
      setAmount('');
      setDate(new Date().toISOString().slice(0, 10));
      setNotes('');
    }
    setError('');
  }, [settlement, groupMembers, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!fromUserId || !toUserId || !amount || !date) {
      setError('Please fill in all fields.');
      return;
    }

    if (fromUserId === toUserId) {
      setError('Sender and Recipient cannot be the same person.');
      return;
    }

    setSubmitting(true);

    const payload = {
      groupId,
      fromUserId,
      toUserId,
      amount: parseFloat(amount),
      date: new Date(date),
      notes
    };

    try {
      if (settlement) {
        await api.put(`/settlements/${settlement.id}`, payload);
      } else {
        await api.post('/settlements', payload);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to save settlement record');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-content" style={{ maxWidth: '500px' }}>
        <div className="modal-header">
          <h2 style={{ fontSize: '1.25rem' }}>{settlement ? 'Edit Settlement Record' : 'Record Repayment'}</h2>
          <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ padding: '0.25rem' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div className="badge badge-danger" style={{ display: 'block', width: '100%', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', textAlign: 'left' }}>
                {error}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Who Paid? (Sender)</label>
              <select
                className="form-input"
                value={fromUserId}
                onChange={(e) => setFromUserId(e.target.value)}
                disabled={submitting}
              >
                <option value="" disabled>Select sender...</option>
                {groupMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.user.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Who Received? (Recipient)</label>
              <select
                className="form-input"
                value={toUserId}
                onChange={(e) => setToUserId(e.target.value)}
                disabled={submitting}
              >
                <option value="" disabled>Select recipient...</option>
                {groupMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.user.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Amount (INR)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="form-input"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                disabled={submitting}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Date</label>
              <input
                type="date"
                className="form-input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                disabled={submitting}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Notes (Optional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Settle up for Swiggy, cash transfer"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn btn-secondary" disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Recording...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
