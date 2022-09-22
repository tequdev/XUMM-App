/*
react-native-keychain
Copyright (c) 2015 Joel Arvidsson
 */

package libs.security.vault.storage.cipherStorage;

import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.text.TextUtils;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import libs.security.vault.exceptions.KeyStoreAccessException;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.Key;
import java.security.KeyStore;
import java.security.NoSuchAlgorithmException;
import java.security.ProviderException;
import java.security.UnrecoverableKeyException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import javax.crypto.Cipher;
import javax.crypto.CipherInputStream;
import javax.crypto.CipherOutputStream;
import javax.crypto.NoSuchPaddingException;
import javax.crypto.spec.IvParameterSpec;

abstract public class CipherStorageBase implements CipherStorage {
  //region Constants
  /** Logging tag. */
  protected static final String LOG_TAG = CipherStorageBase.class.getSimpleName();
  /** Default key storage type/name. */
  public static final String KEYSTORE_TYPE = "AndroidKeyStore";
  /** Size of hash calculation buffer. Default: 4Kb. */
  private static final int BUFFER_SIZE = 4 * 1024;
  /** Default size of read/write operation buffer. Default: 16Kb. */
  private static final int BUFFER_READ_WRITE_SIZE = 4 * BUFFER_SIZE;
  /** Default charset encoding. */
  public static final Charset UTF8 = StandardCharsets.UTF_8;
  //endregion

  //region Members
  /** Guard for {@link #isStrongboxAvailable} field assignment. */
  protected final Object _syncStrongbox = new Object();
  /** Try to resolve support of the strongbox and cache result for future calls. */
  protected transient AtomicBoolean isStrongboxAvailable;
  /** Get cached instance of cipher. Get instance operation is slow. */
  protected transient Cipher cachedCipher;
  /** Cached instance of the Keystore. */
  protected transient KeyStore cachedKeyStore;

  /** Remove key with provided name from security storage. */
  @Override
  public void removeKey(@NonNull final String alias) throws KeyStoreAccessException {
    final KeyStore ks = getKeyStoreAndLoad();

    try {
      if (ks.containsAlias(alias)) {
        ks.deleteEntry(alias);
      }
    } catch (GeneralSecurityException ignored) {
      /* only one exception can be raised by code: 'KeyStore is not loaded' */
    }
  }

  //endregion

  //region Abstract methods

  /** Get encryption algorithm specification builder instance. */
  @NonNull
  protected abstract KeyGenParameterSpec.Builder getKeyGenSpecBuilder(@NonNull final String alias)
    throws GeneralSecurityException;

  /** Try to generate key from provided specification. */
  @NonNull
  protected abstract Key generateKey(@NonNull final KeyGenParameterSpec spec)
    throws GeneralSecurityException;

  /** Get name of the required encryption algorithm. */
  @NonNull
  protected abstract String getEncryptionAlgorithm();

  /** Get transformation algorithm for encrypt/decrypt operations. */
  @NonNull
  protected abstract String getEncryptionTransformation();
  //endregion

  //region Implementation

  /** Get cipher instance and cache it for any next call. */
  @NonNull
  public Cipher getCachedInstance() throws NoSuchAlgorithmException, NoSuchPaddingException {
    if (null == cachedCipher) {
      synchronized (this) {
        if (null == cachedCipher) {
          cachedCipher = Cipher.getInstance(getEncryptionTransformation());
        }
      }
    }

    return cachedCipher;
  }

  /** Extract existing key or generate a new one. In case of problems raise exception. */
  @NonNull
  protected Key extractGeneratedKey(@NonNull final String safeAlias, @NonNull final AtomicInteger retries)
    throws GeneralSecurityException {
    Key key;

    do {
      final KeyStore keyStore = getKeyStoreAndLoad();

      // if key is not available yet, try to generate the strongest possible
      if (!keyStore.containsAlias(safeAlias)) {
        generateKeyAndStoreUnderAlias(safeAlias);
      }

      // throw exception if cannot extract key in several retries
      key = extractKey(keyStore, safeAlias, retries);
    } while (null == key);

    return key;
  }

  /** Try to extract key by alias from keystore, in case of 'known android bug' reduce retry counter. */
  @Nullable
  protected Key extractKey(@NonNull final KeyStore keyStore,
                           @NonNull final String safeAlias,
                           @NonNull final AtomicInteger retry)
    throws GeneralSecurityException {
    final Key key;

    // Fix for android.security.KeyStoreException: Invalid key blob
    // more info: https://stackoverflow.com/questions/36488219/android-security-keystoreexception-invalid-key-blob/36846085#36846085
    try {
      key = keyStore.getKey(safeAlias, null);
    } catch (final UnrecoverableKeyException ex) {
      // try one more time
      if (retry.getAndDecrement() > 0) {
        keyStore.deleteEntry(safeAlias);

        return null;
      }

      throw ex;
    }

    // null if the given alias does not exist or does not identify a key-related entry.
    if (null == key) {
      throw new KeyStoreAccessException("Empty key extracted!");
    }

    return key;
  }

  /** Load key store. */
  @NonNull
  public KeyStore getKeyStoreAndLoad() throws KeyStoreAccessException {
    if (null == cachedKeyStore) {
      synchronized (this) {
        if (null == cachedKeyStore) {
          // initialize instance
          try {
            final KeyStore keyStore = KeyStore.getInstance(KEYSTORE_TYPE);
            keyStore.load(null);

            cachedKeyStore = keyStore;
          } catch (final Throwable fail) {
            throw new KeyStoreAccessException("Could not access Keystore", fail);
          }
        }
      }
    }

    return cachedKeyStore;
  }

  /** Default encryption with cipher without initialization vector. */
  @NonNull
  public byte[] encryptString(@NonNull final Key key, @NonNull final String value)
    throws IOException, GeneralSecurityException {

    return encryptString(key, value, Defaults.encrypt);
  }

  /** Default decryption with cipher without initialization vector. */
  @NonNull
  public String decryptBytes(@NonNull final Key key, @NonNull final byte[] bytes)
    throws IOException, GeneralSecurityException {

    return decryptBytes(key, bytes, Defaults.decrypt);
  }

  /** Encrypt provided string value. */
  @NonNull
  protected byte[] encryptString(@NonNull final Key key, @NonNull final String value,
                                 @Nullable final EncryptStringHandler handler)
    throws IOException, GeneralSecurityException {

    final Cipher cipher = getCachedInstance();

    // encrypt the value using a CipherOutputStream
    try (final ByteArrayOutputStream output = new ByteArrayOutputStream()) {

      // write initialization vector to the beginning of the stream
      if (null != handler) {
        handler.initialize(cipher, key, output);
        output.flush();
      }

      try (final CipherOutputStream encrypt = new CipherOutputStream(output, cipher)) {
        encrypt.write(value.getBytes(UTF8));
      }

      return output.toByteArray();
    } catch (Throwable fail) {
      Log.e(LOG_TAG, fail.getMessage(), fail);

      throw fail;
    }
  }

  /** Decrypt provided bytes to a string. */
  @NonNull
  protected String decryptBytes(@NonNull final Key key, @NonNull final byte[] bytes,
                                @Nullable final DecryptBytesHandler handler)
    throws GeneralSecurityException, IOException {
    final Cipher cipher = getCachedInstance();

    // decrypt the bytes using a CipherInputStream
    try (ByteArrayInputStream in = new ByteArrayInputStream(bytes);
         ByteArrayOutputStream output = new ByteArrayOutputStream()) {

      // read the initialization vector from the beginning of the stream
      if (null != handler) {
        handler.initialize(cipher, key, in);
      }

      try (CipherInputStream decrypt = new CipherInputStream(in, cipher)) {
        copy(decrypt, output);
      }

      return new String(output.toByteArray(), UTF8);
    } catch (Throwable fail) {
      Log.w(LOG_TAG, fail.getMessage(), fail);

      throw fail;
    }
  }

  /** Get the most secured keystore */
  public void generateKeyAndStoreUnderAlias(@NonNull final String alias)
    throws GeneralSecurityException {

    // Firstly, try to generate the key as safe as possible (strongbox).
    // see https://developer.android.com/training/articles/keystore#HardwareSecurityModule

    Key secretKey = null;

    // multi-threaded usage is possible
    synchronized (_syncStrongbox) {
      if (null == isStrongboxAvailable || isStrongboxAvailable.get()) {
        if (null == isStrongboxAvailable) isStrongboxAvailable = new AtomicBoolean(false);

        try {
          secretKey = tryGenerateStrongBoxSecurityKey(alias);

          isStrongboxAvailable.set(true);
        } catch (GeneralSecurityException | ProviderException ex) {
          Log.w(LOG_TAG, "StrongBox security storage is not available.", ex);
        }
      }
    }

    // If that is not possible, we generate the key in a regular way
    // (it still might be generated in hardware, but not in StrongBox)
    if (null == secretKey || !isStrongboxAvailable.get()) {
      try {
        secretKey = tryGenerateRegularSecurityKey(alias);
      } catch (GeneralSecurityException fail) {
        Log.e(LOG_TAG, "Regular security storage is not available.", fail);
        throw fail;
      }
    }
  }

  @NonNull
  protected Key tryGenerateRegularSecurityKey(@NonNull final String alias)
    throws GeneralSecurityException {
    final KeyGenParameterSpec specification = getKeyGenSpecBuilder(alias)
      .build();

    return generateKey(specification);
  }

  @NonNull
  protected Key tryGenerateStrongBoxSecurityKey(@NonNull final String alias)
    throws GeneralSecurityException {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
      throw new KeyStoreAccessException("Strong box security keystore is not supported " +
        "for old API" + Build.VERSION.SDK_INT + ".");
    }

    final KeyGenParameterSpec specification = getKeyGenSpecBuilder(alias)
      .setIsStrongBoxBacked(true)
      .build();

    return generateKey(specification);
  }

  //endregion

  //region Static methods

  /** Convert provided service name to safe not-null/not-empty value. */
  @NonNull
  public static String getDefaultAliasIfEmpty(@Nullable final String service, @NonNull final String fallback) {
    //noinspection ConstantConditions
    return TextUtils.isEmpty(service) ? fallback : service;
  }

  /**
   * Copy input stream to output.
   *
   * @param in  instance of input stream.
   * @param out instance of output stream.
   * @throws IOException read/write operation failure.
   */
  public static void copy(@NonNull final InputStream in, @NonNull final OutputStream out) throws IOException {
    // Transfer bytes from in to out
    final byte[] buf = new byte[BUFFER_READ_WRITE_SIZE];
    int len;

    while ((len = in.read(buf)) > 0) {
      out.write(buf, 0, len);
    }
  }
  //endregion

  //region Nested declarations

  /** Generic cipher initialization. */
  public static final class Defaults {
    public static final EncryptStringHandler encrypt = (cipher, key, output) -> cipher.init(Cipher.ENCRYPT_MODE, key);

    public static final DecryptBytesHandler decrypt = (cipher, key, input) -> cipher.init(Cipher.DECRYPT_MODE, key);
  }

  /** Initialization vector support. */
  public static final class IV {
    /** Encryption/Decryption initialization vector length. */
    public static final int IV_LENGTH = 16;

    /** Save Initialization vector to output stream. */
    public static final EncryptStringHandler encrypt = (cipher, key, output) -> {
      cipher.init(Cipher.ENCRYPT_MODE, key);

      final byte[] iv = cipher.getIV();
      output.write(iv, 0, iv.length);
    };
    /** Read initialization vector from input stream and configure cipher by it. */
    public static final DecryptBytesHandler decrypt = (cipher, key, input) -> {
      final IvParameterSpec iv = readIv(input);
      cipher.init(Cipher.DECRYPT_MODE, key, iv);
    };

    /** Extract initialization vector from provided bytes array. */
    @NonNull
    public static IvParameterSpec readIv(@NonNull final byte[] bytes) throws IOException {
      final byte[] iv = new byte[IV_LENGTH];

      if (IV_LENGTH >= bytes.length)
        throw new IOException("Insufficient length of input data for IV extracting.");

      System.arraycopy(bytes, 0, iv, 0, IV_LENGTH);

      return new IvParameterSpec(iv);
    }

    /** Extract initialization vector from provided input stream. */
    @NonNull
    public static IvParameterSpec readIv(@NonNull final InputStream inputStream) throws IOException {
      final byte[] iv = new byte[IV_LENGTH];
      final int result = inputStream.read(iv, 0, IV_LENGTH);

      if (result != IV_LENGTH)
        throw new IOException("Input stream has insufficient data.");

      return new IvParameterSpec(iv);
    }
  }

  /** Handler for storing cipher configuration in output stream. */
  public interface EncryptStringHandler {
    void initialize(@NonNull final Cipher cipher, @NonNull final Key key, @NonNull final OutputStream output)
      throws GeneralSecurityException, IOException;
  }

  /** Handler for configuring cipher by initialization data from input stream. */
  public interface DecryptBytesHandler {
    void initialize(@NonNull final Cipher cipher, @NonNull final Key key, @NonNull final InputStream input)
      throws GeneralSecurityException, IOException;
  }
  //endregion
}