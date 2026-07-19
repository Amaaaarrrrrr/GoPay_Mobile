import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/services/supabase';
import { normalizeKenyanPhoneInput, getKenyanPhoneVariants, normalizeProfilePin } from '@/utils/phone';
import type { User, UserRole } from '@/types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn: (phone: string, pin: string) => Promise<User>;
  signUp: (phone: string, name: string, pin: string) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const hasBootstrapped = useRef(false);

  useEffect(() => {
    if (hasBootstrapped.current) return;
    hasBootstrapped.current = true;

    const init = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await loadProfile(session.user.id);
        }
      } catch {
        // no-op
      } finally {
        setLoading(false);
      }
    };

    init();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
      } else if (session?.user) {
        await loadProfile(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  /** Loads profile + role, sets state, and returns the resolved User. */
  /** Loads profile + role, sets state, and returns the resolved User. */
async function loadProfile(userId: string): Promise<User> {
    console.log("======================================");
    console.log("Loading profile for:", userId);

    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    console.log("AUTH USER:");
    console.log(authUser);

    const authMeta = authUser?.user_metadata ?? {};

    // ---------------- PROFILE ----------------
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    console.log("PROFILE:");
    console.log(profile);
    console.log("PROFILE ERROR:");
    console.log(profileError);

    // ---------------- ROLE ----------------
    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    console.log("ROLE:");
    console.log(roleData);
    console.log("ROLE ERROR:");
    console.log(roleError);

    // ---------------- WALLET ----------------
    // ---------------- WALLET ----------------
const { data: wallet, error: walletError } = await supabase
  .from("wallet_accounts")
  .select("*")
  .eq("customer_id", userId)
  .maybeSingle();

console.log("WALLET:");
console.log(wallet);
console.log("WALLET ERROR:");
console.log(walletError);

// TEMPORARY DEBUG
const { data: walletSample, error: walletSampleError } = await supabase
  .from("wallet_accounts")
  .select("*")
  .limit(1);

console.log("================================");
console.log("WALLET TABLE SAMPLE:");
console.log(walletSample);
console.log("WALLET TABLE SAMPLE ERROR:");
console.log(walletSampleError);
console.log("================================");

    let data = profile;

    // Create profile if missing
    if (!data) {
      console.log("Profile missing. Creating one...");


const fullName =
  authMeta.full_name ??
  authMeta.name ??
  "";

const parts = fullName.trim().split(/\s+/);

const { error } = await supabase.from("profiles").insert({
  user_id: userId,
  first_name: parts[0] ?? "",
  last_name: parts.slice(1).join(" "),
  email: authUser?.email ?? "",
  phone: authUser?.phone ?? authMeta.phone ?? "",
  pin: "",
});

      if (error) {
        console.log("PROFILE CREATE ERROR:");
        console.log(error);
      }

      const { data: newProfile } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      data = newProfile;
    }

    const name =
      `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim() ||
      authMeta.full_name?.trim() ||
      authMeta.name?.trim() ||
      "";

    const email =
      data?.email?.trim() ||
      authUser?.email?.trim() ||
      "";

    const phone =
      data?.phone?.trim() ||
      authUser?.phone?.trim() ||
      authMeta.phone?.trim() ||
      "";

    // Sync missing fields
    if (
      data &&
      (!data.first_name || !data.last_name || !data.phone || !data.email)
    ) {
      const parts = name.trim().split(/\s+/);
      const { error } = await supabase
        .from("profiles")
        .update({
          first_name: parts[0] ?? "",
          last_name: parts.slice(1).join(" "),
          phone,
          email,
        })
        .eq("user_id", userId);

      if (error) {
        console.log("PROFILE UPDATE ERROR:");
        console.log(error);
      }
    }

    const resolved: User = {
      id: userId,
      name,
      phone,
      email,
      role: (roleData?.role ?? "passenger") as UserRole,
      avatarUrl: data?.avatar_url ?? null,
    };

    console.log("FINAL USER:");
    console.log(resolved);
    console.log("======================================");

    setUser(resolved);

    return resolved;
  }

  async function signIn(phone: string, pin: string): Promise<User> {
    const normalizedPhone = normalizeKenyanPhoneInput(phone);
    const variants = getKenyanPhoneVariants(normalizedPhone);

    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('email, pin, id')
      .in('phone', variants)
      .limit(1)
      .maybeSingle();

    if (profileErr) throw new Error('Unable to find account. Please check your number.');
    if (!profile?.email) throw new Error('Account not found. Please sign up.');

    const rawPin = pin.toUpperCase().trim();
    const storedPin = profile.pin ?? '';

    const passwords = [
      rawPin,
      `pin_${rawPin}_secure`,
      rawPin.toLowerCase(),
      storedPin,
      normalizeProfilePin(storedPin),
    ];

    let lastErr = 'Incorrect PIN. Please try again.';
    for (const password of passwords) {
      const { error } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password,
      });
      const {
          data: { user },
        } = await supabase.auth.getUser();
      if (!error) {
        if (password !== rawPin) {
          // Fire-and-forget self-repair: use void + IIFE so errors never surface to the caller
          void (async () => { try { await supabase.auth.updateUser({ password: rawPin }); } catch {} })();
          void (async () => { try { await supabase.from('profiles').update({ pin: rawPin }).eq('user_id', user!.id); } catch {} })();
        }

        return await loadProfile(user!.id);
      }
      lastErr = error.message;
    }

    throw new Error(lastErr.includes('Invalid') ? 'Incorrect PIN. Please try again.' : lastErr);
  }

  async function signUp(phone: string, name: string, pin: string): Promise<User> {
    const normalizedPhone = normalizeKenyanPhoneInput(phone);
    const email = `${normalizedPhone.replace('+', '')}@gopay.ke`;

    const { data: authData, error: authErr } = await supabase.auth.signUp({
      email,
      password: pin.toUpperCase(),
    });
    if (authErr) throw authErr;
    if (!authData.user) throw new Error('Sign up failed. Please try again.');

    const parts = name.trim().split(/\s+/);
    const userId = authData.user.id;

    await supabase.from("profiles").upsert({
      user_id: userId,
      first_name: parts[0] ?? "",
      last_name: parts.slice(1).join(" "),
      phone: normalizedPhone,
      email,
      pin: pin.toUpperCase(),
    });

    await supabase.from('user_roles').upsert({
      user_id: userId,
      role: 'passenger',
    });

    await supabase.from('wallet_accounts').upsert({
      customer_id: userId,
      balance: 0,
    });

    return await loadProfile(userId);
  }

  async function logout(): Promise<void> {
    setUser(null);                          // clear immediately so UI reacts at once
    await supabase.auth.signOut().catch(() => {});
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
