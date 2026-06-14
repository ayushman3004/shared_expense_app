import { useState, useEffect } from 'react';
import { api } from '../utils/api';

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  groupId: string;
  groupMembers: any[];
  expense?: any;
}

export default function ExpenseModal({ isOpen, onClose, onSuccess, groupId, groupMembers, expense }: ExpenseModalProps) {
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [exchangeRate, setExchangeRate] = useState('83.00'); // default mock rate
  const [paidById, setPaidById] = useState('');
  const [splitType, setSplitType] = useState<'EQUAL' | 'PERCENTAGE' | 'UNEQUAL' | 'SHARE'>('EQUAL');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  
  // Custom split values: object mapping userId -> rawValue
  const [splitValues, setSplitValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Initialize form fields for create or edit
  useEffect(() => {
    if (expense) {
      setDescription(expense.description);
      setAmount(String(expense.amount));
      setCurrency(expense.currency);
      setExchangeRate(expense.exchangeRate ? String(expense.exchangeRate) : '83.00');
      setPaidById(expense.paidById);
      setSplitType(expense.splitType);
      setDate(new Date(expense.date).toISOString().slice(0, 10));
      setNotes(expense.notes || '');
      
      const initialSplits: Record<string, string> = {};
      expense.splits.forEach((s: any) => {
        initialSplits[s.userId] = s.rawValue;
      });
      setSplitValues(initialSplits);
    } else {
      setDescription('');
      setAmount('');
      setCurrency('INR');
      setExchangeRate('83.00');
      setPaidById(groupMembers[0]?.userId || '');
      setSplitType('EQUAL');
      setDate(new Date().toISOString().slice(0, 10));
      setNotes('');
      setSplitValues({});
    }
    setError('');
  }, [expense, groupMembers, isOpen]);

  // Determine active members on the selected date
  const selectedDate = new Date(date);
  const activeMembers = groupMembers.filter((m) => {
    const joined = new Date(m.joinedAt);
    const left = m.leftAt ? new Date(m.leftAt) : null;
    return selectedDate >= joined && (left === null || selectedDate <= left);
  });

  // Calculate live split previews for GUI presentation
  const numActive = activeMembers.length;
  const numAmt = parseFloat(amount) || 0;
  const rateNum = currency === 'USD' ? parseFloat(exchangeRate) || 1 : 1;
  const totalInr = numAmt * rateNum;

  const getSplitPreview = (userId: string) => {
    if (totalInr <= 0) return '0.00';

    if (splitType === 'EQUAL') {
      return (totalInr / numActive).toFixed(2);
    }

    const rawVal = splitValues[userId] || '';
    if (splitType === 'PERCENTAGE') {
      const pct = parseFloat(rawVal.replace('%', '')) || 0;
      return ((totalInr * pct) / 100).toFixed(2);
    }

    if (splitType === 'SHARE') {
      const weight = parseFloat(rawVal) || 0;
      const totalWeight = activeMembers.reduce((sum, m) => sum + (parseFloat(splitValues[m.userId]) || 0), 0);
      if (totalWeight <= 0) return '0.00';
      return ((totalInr * weight) / totalWeight).toFixed(2);
    }

    if (splitType === 'UNEQUAL') {
      const val = parseFloat(rawVal) || 0;
      return (val * rateNum).toFixed(2); // Preview in INR
    }

    return '0.00';
  };

  const handleInputChange = (userId: string, val: string) => {
    setSplitValues((prev) => ({
      ...prev,
      [userId]: val
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!description || !amount || !paidById || !date) {
      setError('Please fill in all standard fields.');
      return;
    }

    // Double check if payer is active on this date
    const payerIsActive = activeMembers.some(m => m.userId === paidById);
    if (!payerIsActive) {
      const payerName = groupMembers.find(m => m.userId === paidById)?.user.name || 'Payer';
      setError(`Cannot create expense. Payer "${payerName}" is not an active member on the selected date.`);
      return;
    }

    // Format splits array for backend
    const formattedSplits = activeMembers.map((m) => {
      let rawVal = splitValues[m.userId] || '';
      
      // Default fallback values
      if (splitType === 'EQUAL') {
        rawVal = 'equal';
      } else if (splitType === 'PERCENTAGE') {
        if (!rawVal.endsWith('%')) rawVal = `${rawVal || 0}%`;
      } else if (splitType === 'SHARE') {
        rawVal = rawVal || '1';
      } else if (splitType === 'UNEQUAL') {
        rawVal = rawVal || '0';
      }

      return {
        userId: m.userId,
        rawValue: rawVal
      };
    });

    // Validations client-side before POST
    if (splitType === 'PERCENTAGE') {
      const sum = formattedSplits.reduce((s, split) => s + (parseFloat(split.rawValue.replace('%', '')) || 0), 0);
      if (Math.abs(sum - 100) > 0.01) {
        setError(`Percentage splits must sum to exactly 100%. (Current sum: ${sum}%)`);
        return;
      }
    } else if (splitType === 'UNEQUAL') {
      const sum = formattedSplits.reduce((s, split) => s + (parseFloat(split.rawValue) || 0), 0);
      if (Math.abs(sum - numAmt) > 0.01) {
        setError(`The sum of individual splits (${sum.toFixed(2)}) must equal the total amount (${numAmt.toFixed(2)}).`);
        return;
      }
    } else if (splitType === 'SHARE') {
      const totalWeight = formattedSplits.reduce((s, split) => s + (parseFloat(split.rawValue) || 0), 0);
      if (totalWeight <= 0) {
        setError('Total weights must be greater than 0.');
        return;
      }
    }

    setSubmitting(true);

    const payload = {
      groupId,
      description,
      amount: parseFloat(amount),
      currency,
      exchangeRate: currency === 'USD' ? parseFloat(exchangeRate) : null,
      paidById,
      splitType,
      date: new Date(date),
      notes,
      splits: formattedSplits
    };

    try {
      if (expense) {
        await api.put(`/expenses/${expense.id}`, payload);
      } else {
        await api.post('/expenses', payload);
      }
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Failed to save expense');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-content" style={{ maxWidth: '640px' }}>
        <div className="modal-header">
          <h2 style={{ fontSize: '1.25rem' }}>{expense ? 'Edit Expense' : 'Record Shared Expense'}</h2>
          <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ padding: '0.25rem' }}>✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {error && (
              <div className="badge badge-danger" style={{ display: 'block', width: '100%', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', textAlign: 'left' }}>
                {error}
              </div>
            )}

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Description</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. BigBasket Groceries"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
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
            </div>

            <div className="grid-3">
              <div className="form-group">
                <label className="form-label">Amount</label>
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
                <label className="form-label">Currency</label>
                <select
                  className="form-input"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  disabled={submitting}
                >
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                </select>
              </div>

              {currency === 'USD' && (
                <div className="form-group">
                  <label className="form-label">USD → INR Rate</label>
                  <input
                    type="number"
                    step="0.0001"
                    className="form-input"
                    value={exchangeRate}
                    onChange={(e) => setExchangeRate(e.target.value)}
                    required
                    disabled={submitting}
                  />
                </div>
              )}
            </div>

            <div className="grid-2">
              <div className="form-group">
                <label className="form-label">Paid By</label>
                <select
                  className="form-input"
                  value={paidById}
                  onChange={(e) => setPaidById(e.target.value)}
                  disabled={submitting}
                >
                  <option value="" disabled>Select payer...</option>
                  {/* Payer must be active on selected date */}
                  {groupMembers.map((m) => {
                    const isActive = activeMembers.some(am => am.userId === m.userId);
                    return (
                      <option key={m.userId} value={m.userId} disabled={!isActive}>
                        {m.user.name} {!isActive ? '(Inactive on this date)' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Split Method</label>
                <select
                  className="form-input"
                  value={splitType}
                  onChange={(e) => {
                    setSplitType(e.target.value as any);
                    setSplitValues({});
                  }}
                  disabled={submitting}
                >
                  <option value="EQUAL">Split Equally</option>
                  <option value="PERCENTAGE">By Percentages (%)</option>
                  <option value="UNEQUAL">Unequal Amounts</option>
                  <option value="SHARE">Weighted Shares</option>
                </select>
              </div>
            </div>

            {/* Split Matrix section */}
            <div className="split-matrix">
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.4rem', marginBottom: '0.5rem' }}>
                <span>Active Participants ({activeMembers.length})</span>
                <span>Split Share Value (INR)</span>
              </div>
              
              {activeMembers.map((m) => {
                const userVal = splitValues[m.userId] || '';
                return (
                  <div key={m.userId} className="split-row">
                    <div>
                      <strong>{m.user.name}</strong>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>@{m.user.username}</span>
                    </div>

                    <div className="split-input-wrapper">
                      {splitType !== 'EQUAL' && (
                        <input
                          type="text"
                          className="form-input"
                          style={{ width: '80px', padding: '0.25rem 0.5rem', textAlign: 'right', fontSize: '0.8rem' }}
                          placeholder={splitType === 'PERCENTAGE' ? '0%' : splitType === 'SHARE' ? '1' : '0.00'}
                          value={userVal}
                          onChange={(e) => handleInputChange(m.userId, e.target.value)}
                          disabled={submitting}
                        />
                      )}
                      <span style={{ fontSize: '0.85rem', width: '80px', textAlign: 'right', fontWeight: 600 }}>
                        ₹{getSplitPreview(m.userId)}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Informational help context */}
              {splitType === 'PERCENTAGE' && (
                <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <span>Sum of percentages:</span>
                  <strong style={{ color: Math.abs(activeMembers.reduce((s, m) => s + (parseFloat(splitValues[m.userId]?.replace('%', '')) || 0), 0) - 100) > 0.01 ? 'var(--danger)' : 'var(--success)' }}>
                    {activeMembers.reduce((s, m) => s + (parseFloat(splitValues[m.userId]?.replace('%', '')) || 0), 0)}% / 100%
                  </strong>
                </div>
              )}
              {splitType === 'UNEQUAL' && (
                <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  <span>Sum of individual amounts:</span>
                  <strong style={{ color: Math.abs(activeMembers.reduce((s, m) => s + (parseFloat(splitValues[m.userId]) || 0), 0) - numAmt) > 0.01 ? 'var(--danger)' : 'var(--success)' }}>
                    {currency === 'USD' ? '$' : '₹'}{activeMembers.reduce((s, m) => s + (parseFloat(splitValues[m.userId]) || 0), 0).toFixed(2)} / {currency === 'USD' ? '$' : '₹'}{numAmt.toFixed(2)}
                  </strong>
                </div>
              )}
            </div>

            <div className="form-group" style={{ marginTop: '1.25rem', marginBottom: 0 }}>
              <label className="form-label">Notes (Optional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Cancelled Swiggy slot refund, cylinder delivery charge"
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
              {submitting ? 'Saving...' : 'Save Expense'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
