import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, getTokens } from '../utils/api';
import { 
  Plus, Upload, Receipt, DollarSign, ArrowLeftRight, Users, 
  Settings, CheckCircle, Info, Calendar, Trash2, Edit 
} from 'lucide-react';

// Import modals
import ExpenseModal from '../components/ExpenseModal';
import SettlementModal from '../components/SettlementModal';
import MembersModal from '../components/MembersModal';

interface Expense {
  id: string;
  description: string;
  amount: string;
  currency: string;
  exchangeRate: string | null;
  amountInr: string;
  paidBy: { id: string; name: string };
  splitType: string;
  date: string;
  notes: string | null;
  splits: { userId: string; amountInr: string; rawValue: string }[];
}

interface Settlement {
  id: string;
  fromUser: { id: string; name: string };
  toUser: { id: string; name: string };
  amount: string;
  date: string;
  notes: string | null;
}

export default function GroupDashboard() {
  const { groupId } = useParams<{ groupId: string }>();
  const { user } = getTokens();
  
  const [group, setGroup] = useState<any>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [balancesData, setBalancesData] = useState<any>(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Tab state: expenses, balances, settlements, members
  const [activeTab, setActiveTab] = useState<'expenses' | 'balances' | 'settlements' | 'members'>('expenses');

  // Modal control states
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [selectedExpense, setSelectedExpense] = useState<Expense | undefined>(undefined);
  
  const [settlementModalOpen, setSettlementModalOpen] = useState(false);
  const [selectedSettlement, setSelectedSettlement] = useState<Settlement | undefined>(undefined);

  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [selectedMember, setSelectedMember] = useState<any>(undefined);

  // Rohan's audit state
  const [auditUserId, setAuditUserId] = useState<string | null>(null);

  const fetchGroupDetails = async () => {
    if (!groupId) return;
    try {
      setLoading(true);
      const groupInfo = await api.get(`/groups/${groupId}`);
      setGroup(groupInfo);
      
      const [expData, setDataSettlements, balances] = await Promise.all([
        api.get(`/expenses?groupId=${groupId}`),
        api.get(`/settlements?groupId=${groupId}`),
        api.get(`/groups/${groupId}/balances`)
      ]);

      setExpenses(expData);
      setSettlements(setDataSettlements);
      setBalancesData(balances);
    } catch (err: any) {
      setError(err.message || 'Failed to load group details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroupDetails();
  }, [groupId]);

  const handleExpenseSuccess = () => {
    setExpenseModalOpen(false);
    setSelectedExpense(undefined);
    fetchGroupDetails();
  };

  const handleSettlementSuccess = () => {
    setSettlementModalOpen(false);
    setSelectedSettlement(undefined);
    fetchGroupDetails();
  };

  const handleMemberSuccess = () => {
    setMembersModalOpen(false);
    setSelectedMember(undefined);
    fetchGroupDetails();
  };

  const handleDeleteExpense = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this expense?')) return;
    try {
      await api.delete(`/expenses/${id}`);
      fetchGroupDetails();
    } catch (err: any) {
      alert(err.message || 'Failed to delete expense');
    }
  };

  const handleDeleteSettlement = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this settlement record?')) return;
    try {
      await api.delete(`/settlements/${id}`);
      fetchGroupDetails();
    } catch (err: any) {
      alert(err.message || 'Failed to delete settlement');
    }
  };

  if (loading && !group) {
    return <p style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-secondary)' }}>Loading group details...</p>;
  }

  if (error && !group) {
    return (
      <div className="main-content">
        <Link to="/" className="btn btn-secondary btn-sm" style={{ marginBottom: '1.5rem' }}>
          <ArrowLeftRight size={14} style={{ transform: 'rotate(180deg)' }} /> Back to Dashboard
        </Link>
        <div className="badge badge-danger" style={{ display: 'block', width: '100%', padding: '1rem', textAlign: 'left' }}>
          {error}
        </div>
      </div>
    );
  }

  // Get current user's balance
  const userAudit = balancesData?.memberAudits?.[user?.id];
  const userBalance = userAudit?.netBalance || 0;

  return (
    <div className="main-content">
      {/* Header section */}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1.5rem', marginBottom: '2rem' }}>
        <div>
          <Link to="/" style={{ color: 'var(--text-secondary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
            ← Back to Dashboard
          </Link>
          <h1 style={{ fontSize: '2.5rem', margin: '0 0 0.5rem 0' }}>{group.name}</h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>{group.description || 'No description provided.'}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span 
              className="badge badge-info" 
              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }} 
              onClick={() => setActiveTab('members')}
              title="Click to view timeline settings"
            >
              <Users size={12} />
              {group.members.length} members
            </span>
            <button 
              onClick={() => { setSelectedMember(undefined); setMembersModalOpen(true); }}
              className="btn btn-secondary btn-sm"
              style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.25rem 0.5rem', fontSize: '0.75rem', borderRadius: '4px' }}
            >
              <Plus size={12} /> Add Member
            </button>
          </div>
        </div>

        {/* Dashboard statistics card */}
        <div className="card" style={{ padding: '1rem 1.5rem', display: 'flex', gap: '2rem', marginBottom: 0, alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Your Balance</span>
            <h2 style={{ fontSize: '1.5rem', color: userBalance > 0 ? 'var(--success)' : userBalance < 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
              {userBalance > 0 ? '+' : ''}₹{userBalance.toFixed(2)}
            </h2>
          </div>
          <div style={{ width: '1px', alignSelf: 'stretch', backgroundColor: 'var(--border-color)' }}></div>
          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Group Spend</span>
            <h2 style={{ fontSize: '1.5rem' }}>
              ₹{expenses.reduce((s, e) => s + Number(e.amountInr), 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </h2>
          </div>
        </div>
      </div>

      {/* Tabs list navigation */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '1.5rem', gap: '1rem', overflowX: 'auto' }}>
        <button
          onClick={() => setActiveTab('expenses')}
          className={`btn ${activeTab === 'expenses' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: activeTab === 'expenses' ? '2px' : '1px' }}
        >
          <Receipt size={16} /> Expenses
        </button>
        <button
          onClick={() => setActiveTab('balances')}
          className={`btn ${activeTab === 'balances' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: activeTab === 'balances' ? '2px' : '1px' }}
        >
          <ArrowLeftRight size={16} /> Balances & Settle Up
        </button>
        <button
          onClick={() => setActiveTab('settlements')}
          className={`btn ${activeTab === 'settlements' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: activeTab === 'settlements' ? '2px' : '1px' }}
        >
          <DollarSign size={16} /> Settlements Log
        </button>
        <button
          onClick={() => setActiveTab('members')}
          className={`btn ${activeTab === 'members' ? 'btn-primary' : 'btn-secondary'}`}
          style={{ borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: activeTab === 'members' ? '2px' : '1px' }}
        >
          <Users size={16} /> Timeline Settings
        </button>
      </div>

      {/* EXPENSES TAB */}
      {activeTab === 'expenses' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Shared Bills ({expenses.length})</h3>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Link to={`/groups/${groupId}/import`} className="btn btn-secondary btn-sm">
                <Upload size={14} /> Import CSV
              </Link>
              <button onClick={() => { setSelectedExpense(undefined); setExpenseModalOpen(true); }} className="btn btn-primary btn-sm">
                <Plus size={14} /> Record Shared Expense
              </button>
            </div>
          </div>

          {expenses.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem', borderStyle: 'dashed' }}>
              <Receipt size={32} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
              <p style={{ color: 'var(--text-secondary)' }}>No expenses recorded yet in this group.</p>
              <button onClick={() => setExpenseModalOpen(true)} className="btn btn-primary btn-sm" style={{ marginTop: '1rem' }}>
                Create First Expense
              </button>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Payer</th>
                    <th>Split Type</th>
                    <th>Total Amount</th>
                    <th>Amount in INR</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((exp) => (
                    <tr key={exp.id}>
                      <td>{new Date(exp.date).toISOString().slice(0, 10)}</td>
                      <td>
                        <strong>{exp.description}</strong>
                        {exp.notes && <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>{exp.notes}</p>}
                      </td>
                      <td>{exp.paidBy.name}</td>
                      <td><span className="badge badge-info">{exp.splitType}</span></td>
                      <td className="currency-symbol">
                        {exp.currency === 'USD' ? '$' : '₹'}{Number(exp.amount).toFixed(2)}
                      </td>
                      <td>₹{Number(exp.amountInr).toFixed(2)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => { setSelectedExpense(exp); setExpenseModalOpen(true); }}
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '0.3rem' }}
                          >
                            <Edit size={12} />
                          </button>
                          <button
                            onClick={() => handleDeleteExpense(exp.id)}
                            className="btn btn-danger btn-sm"
                            style={{ padding: '0.3rem' }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* BALANCES TAB */}
      {activeTab === 'balances' && (
        <div>
          <div className="grid-2">
            {/* Aisha's Simplified view */}
            <div className="card">
              <h3 className="card-title" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                <span>Simplified Settle Up (Aisha's View)</span>
                <CheckCircle size={18} style={{ color: 'var(--success)' }} />
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                The minimum number of transactions needed to settle all flat debts.
              </p>

              {balancesData?.simplifiedSettlements?.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--success)' }}>
                  <CheckCircle size={28} style={{ marginBottom: '0.5rem' }} />
                  <p style={{ fontWeight: 600 }}>All settled! No one owes anything.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {balancesData?.simplifiedSettlements?.map((s: any, idx: number) => (
                    <div key={idx} className="card" style={{ padding: '1rem', marginBottom: 0, backgroundColor: 'rgba(255,255,255,0.02)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong>{s.fromUserName}</strong> owes <strong>{s.toUserName}</strong>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: '1.15rem', fontWeight: 'bold', color: 'var(--warning)' }}>₹{s.amount.toFixed(2)}</span>
                        {/* Auto-fill recording a settlement */}
                        <button
                          onClick={() => {
                            setSelectedSettlement(undefined);
                            setSettlementModalOpen(true);
                            // We will pre-fill the sender and receiver in the modal state
                          }}
                          className="btn btn-primary btn-sm"
                        >
                          Settle
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Individual balances list with Rohan's Audit capability */}
            <div className="card">
              <h3 className="card-title" style={{ borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                <span>Group Balance Summary</span>
                <Users size={18} style={{ color: 'var(--info)' }} />
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                Hover or click <b>Audit</b> to see exactly which expenses make up a member's balance.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {Object.values(balancesData?.memberAudits || {}).map((audit: any) => {
                  const bal = audit.netBalance;
                  return (
                    <div key={audit.user.id} className="card" style={{ padding: '0.75rem 1rem', marginBottom: 0, backgroundColor: 'rgba(255,255,255,0.01)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong style={{ fontSize: '1.05rem' }}>{audit.user.name}</strong>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          Joined: {new Date(audit.joinedAt).toISOString().slice(0, 10)} 
                          {audit.leftAt ? ` | Left: ${new Date(audit.leftAt).toISOString().slice(0, 10)}` : ''}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '1.1rem', color: bal > 0 ? 'var(--success)' : bal < 0 ? 'var(--danger)' : 'var(--text-primary)' }}>
                          {bal > 0 ? '+' : ''}₹{bal.toFixed(2)}
                        </span>
                        <button
                          onClick={() => setAuditUserId(auditUserId === audit.user.id ? null : audit.user.id)}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                        >
                          <Info size={12} />
                          {auditUserId === audit.user.id ? 'Hide' : 'Audit'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Rohan's "No Magic Numbers" Audit Panel */}
          {auditUserId && (() => {
            const audit = balancesData.memberAudits[auditUserId];
            return (
              <div className="card" style={{ border: '2px solid var(--primary)', animation: 'fadeIn 0.2s ease' }}>
                <h3 className="card-title" style={{ color: 'var(--primary)' }}>
                  <span>Detailed Balance Audit: {audit.user.name}</span>
                  <button onClick={() => setAuditUserId(null)} className="btn btn-secondary btn-sm" style={{ padding: '0.25rem' }}>
                    ✕
                  </button>
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                  Verification calculations demonstrating the math behind the net balance of <b>₹{audit.netBalance.toFixed(2)}</b>.
                </p>

                <div className="grid-2">
                  {/* Credits (What they paid) */}
                  <div className="card" style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.01)' }}>
                    <h4 style={{ color: 'var(--success)', marginBottom: '0.75rem', fontSize: '0.95rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span>1. Payments Made (Credits)</span>
                      <span>+₹{audit.credits.reduce((s: any, c: any) => s + c.creditAmount, 0).toFixed(2)}</span>
                    </h4>
                    {audit.credits.length === 0 ? (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Did not pay for any group expenses.</p>
                    ) : (
                      <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {audit.credits.map((c: any, i: number) => (
                          <div key={i} style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '0.25rem' }}>
                            <span>{new Date(c.date).toISOString().slice(5, 10)} - {c.description}</span>
                            <strong>+₹{c.creditAmount.toFixed(2)}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Debits (What they owe) */}
                  <div className="card" style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.01)' }}>
                    <h4 style={{ color: 'var(--danger)', marginBottom: '0.75rem', fontSize: '0.95rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span>2. Split Shares (Debits)</span>
                      <span>-₹{audit.debits.reduce((s: any, d: any) => s + d.debitAmount, 0).toFixed(2)}</span>
                    </h4>
                    {audit.debits.length === 0 ? (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No split shares assigned.</p>
                    ) : (
                      <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {audit.debits.map((d: any, i: number) => (
                          <div key={i} style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '0.25rem' }}>
                            <span>{new Date(d.date).toISOString().slice(5, 10)} - {d.description} (paid by {d.paidBy})</span>
                            <strong>-₹{d.debitAmount.toFixed(2)}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Repayments Sent */}
                  <div className="card" style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.01)', marginBottom: 0 }}>
                    <h4 style={{ color: 'var(--info)', marginBottom: '0.75rem', fontSize: '0.95rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span>3. Settlements Sent</span>
                      <span>+₹{audit.settlementsSent.reduce((s: any, st: any) => s + st.amount, 0).toFixed(2)}</span>
                    </h4>
                    {audit.settlementsSent.length === 0 ? (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No manual settlements sent.</p>
                    ) : (
                      <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {audit.settlementsSent.map((st: any, i: number) => (
                          <div key={i} style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '0.25rem' }}>
                            <span>{new Date(st.date).toISOString().slice(5, 10)} - To {st.recipient}</span>
                            <strong>+₹{st.amount.toFixed(2)}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Repayments Received */}
                  <div className="card" style={{ padding: '1rem', backgroundColor: 'rgba(255, 255, 255, 0.01)', marginBottom: 0 }}>
                    <h4 style={{ color: 'var(--warning)', marginBottom: '0.75rem', fontSize: '0.95rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span>4. Settlements Received</span>
                      <span>-₹{audit.settlementsReceived.reduce((s: any, sr: any) => s + sr.amount, 0).toFixed(2)}</span>
                    </h4>
                    {audit.settlementsReceived.length === 0 ? (
                      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No manual settlements received.</p>
                    ) : (
                      <div style={{ maxHeight: '150px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {audit.settlementsReceived.map((sr: any, i: number) => (
                          <div key={i} style={{ fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '0.25rem' }}>
                            <span>{new Date(sr.date).toISOString().slice(5, 10)} - From {sr.sender}</span>
                            <strong>-₹{sr.amount.toFixed(2)}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Audit summary calculation footer */}
                <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem', display: 'flex', justifyContent: 'flex-end', fontSize: '0.95rem' }}>
                  <div>
                    Credits: <span style={{ color: 'var(--success)' }}>+₹{audit.credits.reduce((s: any, c: any) => s + c.creditAmount, 0).toFixed(2)}</span>
                    {' '}| Debits: <span style={{ color: 'var(--danger)' }}>-₹{audit.debits.reduce((s: any, d: any) => s + d.debitAmount, 0).toFixed(2)}</span>
                    {' '}| Sent: <span style={{ color: 'var(--info)' }}>+₹{audit.settlementsSent.reduce((s: any, st: any) => s + st.amount, 0).toFixed(2)}</span>
                    {' '}| Recv: <span style={{ color: 'var(--warning)' }}>-₹{audit.settlementsReceived.reduce((s: any, sr: any) => s + sr.amount, 0).toFixed(2)}</span>
                    <h3 style={{ marginTop: '0.5rem', fontSize: '1.25rem' }}>
                      Net Sum Balance: <span style={{ color: audit.netBalance >= 0 ? 'var(--success)' : 'var(--danger)' }}>₹{audit.netBalance.toFixed(2)}</span>
                    </h3>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* SETTLEMENTS TAB */}
      {activeTab === 'settlements' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Settlements Record Log ({settlements.length})</h3>
            <button onClick={() => { setSelectedSettlement(undefined); setSettlementModalOpen(true); }} className="btn btn-primary btn-sm">
              <Plus size={14} /> Record Repayment
            </button>
          </div>

          {settlements.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '3rem 1.5rem', borderStyle: 'dashed' }}>
              <DollarSign size={32} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }} />
              <p style={{ color: 'var(--text-secondary)' }}>No repayments recorded yet.</p>
            </div>
          ) : (
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Sender (Paid Back)</th>
                    <th>Recipient</th>
                    <th>Repayment Amount</th>
                    <th>Notes</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s) => (
                    <tr key={s.id}>
                      <td>{new Date(s.date).toISOString().slice(0, 10)}</td>
                      <td>{s.fromUser.name}</td>
                      <td>{s.toUser.name}</td>
                      <td style={{ fontWeight: 600, color: 'var(--success)' }}>₹{Number(s.amount).toFixed(2)}</td>
                      <td>{s.notes || '-'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => { setSelectedSettlement(s); setSettlementModalOpen(true); }}
                            className="btn btn-secondary btn-sm"
                            style={{ padding: '0.3rem' }}
                          >
                            <Edit size={12} />
                          </button>
                          <button
                            onClick={() => handleDeleteSettlement(s.id)}
                            className="btn btn-danger btn-sm"
                            style={{ padding: '0.3rem' }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* MEMBERS TIMELINE TAB */}
      {activeTab === 'members' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Group Members & Timelines</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Timeline configurations ensuring temporal calculations are correct (e.g. Sam won't pay March bills!).</p>
            </div>
            <button onClick={() => { setSelectedMember(undefined); setMembersModalOpen(true); }} className="btn btn-primary btn-sm">
              <Plus size={14} /> Add New Member
            </button>
          </div>

          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Joined Timeline</th>
                  <th>Left Timeline</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {group.members.map((m: any) => {
                  const joined = new Date(m.joinedAt).toISOString().slice(0, 10);
                  const left = m.leftAt ? new Date(m.leftAt).toISOString().slice(0, 10) : '-';
                  const isActive = !m.leftAt || new Date(m.leftAt) >= new Date();

                  return (
                    <tr key={m.userId}>
                      <td><strong>{m.user.name}</strong></td>
                      <td>@{m.user.username}</td>
                      <td><span className={`badge ${m.role === 'ADMIN' ? 'badge-info' : 'badge-secondary'}`}>{m.role}</span></td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Calendar size={12} />
                          {joined}
                        </span>
                      </td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Calendar size={12} />
                          {left}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${isActive ? 'badge-success' : 'badge-danger'}`}>
                          {isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          onClick={() => { setSelectedMember(m); setMembersModalOpen(true); }}
                          className="btn btn-secondary btn-sm"
                          style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem' }}
                        >
                          <Settings size={12} /> Configure
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      {expenseModalOpen && (
        <ExpenseModal
          isOpen={expenseModalOpen}
          onClose={() => setExpenseModalOpen(false)}
          onSuccess={handleExpenseSuccess}
          groupId={groupId!}
          groupMembers={group.members}
          expense={selectedExpense}
        />
      )}

      {settlementModalOpen && (
        <SettlementModal
          isOpen={settlementModalOpen}
          onClose={() => setSettlementModalOpen(false)}
          onSuccess={handleSettlementSuccess}
          groupId={groupId!}
          groupMembers={group.members}
          settlement={selectedSettlement}
        />
      )}

      {membersModalOpen && (
        <MembersModal
          isOpen={membersModalOpen}
          onClose={() => setMembersModalOpen(false)}
          onSuccess={handleMemberSuccess}
          groupId={groupId!}
          member={selectedMember}
        />
      )}
    </div>
  );
}
