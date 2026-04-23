#!/usr/bin/env cabal
{- cabal:
build-depends:
    base,
    turtle,
    aeson,
    bytestring,
    text,
    cryptonite,
    memory,
    base64-bytestring,
    raw-strings-qq
-}
{-# LANGUAGE ImportQualifiedPost #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE QuasiQuotes #-}
{-# LANGUAGE ScopedTypeVariables #-}

import Control.Monad (filterM, forM, forM_)
import Crypto.Hash (Digest, SHA256 (..), hash)
import Data.Aeson
import Data.Aeson.Key qualified as K
import Data.Aeson.KeyMap qualified as KM
import Data.ByteArray (convert)
import Data.ByteString qualified as BS
import Data.ByteString.Base64 qualified as B64
import Data.ByteString.Lazy qualified as BSL
import Data.Text qualified as T
import Data.Text.Encoding qualified as TE
import System.Info (os)
import Text.RawString.QQ (r)
import Turtle
import Prelude hiding (FilePath)

-- =====================================================================
-- 1. STRICTLY TYPED DATA STRUCTURES
-- The compiler rigidly enforces that 'destPath' is an OS path and
-- 'fileData' is a Byte buffer. You cannot accidentally swap them.
-- =====================================================================
data WriteOp = WriteOp
  { destPath :: FilePath,
    fileData :: BS.ByteString
  }

-- =====================================================================
-- 2. PURE MATHEMATICAL CRYPTOGRAPHY (No OS Side-Effects)
-- =====================================================================
sha256Base64NoPadding :: BS.ByteString -> T.Text
sha256Base64NoPadding bs =
  let digest :: Digest SHA256 = hash bs
      b64 = B64.encode (convert digest)
   in T.dropWhileEnd (== '=') (TE.decodeUtf8 b64)

-- =====================================================================
-- 3. JAVASCRIPT INJECTION (The "Logo" Code-as-Data part)
-- We use a QuasiQuoter [r|...|] to cleanly embed multiline JS logic.
-- =====================================================================
generateInjectionScript :: T.Text -> BS.ByteString
generateInjectionScript mode =
  let jsTemplate =
        [r|
<script>
(function() {
    const clickedButtons = new WeakSet();
    const flags = { __MODE_FLAG__ };
    const SELECTOR = 'button, a.monaco-button';

    // ... [DOM Recovery Logic Omitted for Brevity] ...
    console.log("Antigravity patched via the Haskell Turtle!");
})();
</script>
|]
      modeFlag =
        if mode == "all"
          then "retry: true, continue: true"
          else "mode: '" <> mode <> "'"
      finalJs = T.replace "__MODE_FLAG__" modeFlag jsTemplate
   in TE.encodeUtf8 finalJs

-- =====================================================================
-- 4. TYPE-SAFE OS PROBING (The Bash side)
-- Runs in the 'IO' Monad because it touches the stateful file system.
-- =====================================================================
findWorkbenchHtml :: IO (Maybe FilePath)
findWorkbenchHtml = do
  let rel = "resources/app/out/vs/code/electron-browser/workbench/workbench.html"
      -- Pattern matching forces us to handle OS branching safely at compile-time
      candidates = case System.Info.os of
        "linux" ->
          [ "/usr/share/antigravity" </> rel,
            "/opt/antigravity" </> rel
          ]
        "darwin" -> ["/Applications/Antigravity.app/Contents/Resources" </> rel]
        "mingw32" -> ["C:/Program Files/Antigravity" </> rel]
        _ -> []

  -- Turtle's 'testfile' acts exactly like Bash `[ -f path ]` but returns a typed Bool.
  -- 'filterM' natively pipes this OS check across our Lisp-style list.
  existing <- filterM testfile candidates
  return $ case existing of
    (first : _) -> Just first
    [] -> Nothing

-- =====================================================================
-- 5. PURE JSON ALGEBRAIC MANIPULATION (Defeating Bash's text-fragility)
-- =====================================================================
queueChecksum :: [WriteOp] -> FilePath -> BS.ByteString -> IO [WriteOp]
queueChecksum writes prodPath htmlBuf = do
  exists <- testfile prodPath
  if not exists
    then return writes
    else do
      let newHash = sha256Base64NoPadding htmlBuf

      -- Aeson parses the JSON natively into an Algebraic Data Type (Value).
      -- The compiler FORCES us to handle the 'Nothing' case if the file is corrupted.
      maybeJson :: Maybe Value <- decodeStrict <$> BS.readFile (encodeString prodPath)

      case maybeJson of
        Just (Object rootObj) ->
          case KM.lookup "checksums" rootObj of
            Just (Object checksums) -> do
              let wbKey = K.fromText "vs/code/electron-browser/workbench/workbench.html"
              -- Update the JSON tree immutably
              let updatedChecksums = KM.insert wbKey (String newHash) checksums
                  updatedRoot = KM.insert "checksums" (Object updatedChecksums) rootObj
                  newJsonBytes = BSL.toStrict (encode (Object updatedRoot))

              return $ writes ++ [WriteOp prodPath (newJsonBytes <> "\n")]
            _ -> return writes
        _ -> return writes

-- =====================================================================
-- 6. PRIVILEGE ESCALATION (Bridging pure data back to the OS)
-- =====================================================================
writeElevated :: [WriteOp] -> IO ()
writeElevated [] = return ()
writeElevated writes = do
  -- We loop over our typed WriteOps, spawning temp files safely
  cmds <- forM (zip [1 ..] writes) $ \(i :: Int, writeOp) -> do
    let tmpPath = "/tmp" </> fromText ("antigravity-patch-" <> repr i)

    liftIO $ BS.writeFile (encodeString tmpPath) (fileData writeOp)

    -- TYPESAFE PATH FORMATTING: '%fp' rigidly demands a FilePath type.
    -- If tmpPath was just an arbitrary text string, this wouldn't compile!
    return (format ("cp '" % fp % "' '" % fp % "'") tmpPath (destPath writeOp))

  let combinedCmd = T.intercalate " && " cmds

  echo "Requesting sudo elevation to commit changes..."
  -- 'procs' pipes the string natively to the bash subshell
  procs "sudo" ["sh", "-c", combinedCmd] empty

  -- Cleanup temp files
  forM_ (zip [1 ..] writes) $ \(i :: Int, _) ->
    rm ("/tmp" </> fromText ("antigravity-patch-" <> repr i))

-- =====================================================================
-- 7. MAIN ORCHESTRATION
-- =====================================================================
main :: IO ()
main = do
  echo "========================================"
  echo " ANTIGRAVITY PATCHER: HASKELL TURTLE OS "
  echo "========================================"

  maybeWb <- findWorkbenchHtml
  case maybeWb of
    Nothing -> die "Error: Antigravity not installed on this system."
    Just wb -> do
      let bak = wb <.> "bak"
          prod = directory wb </> "../../../../../product.json"
          prodBak = prod <.> "bak"

      -- Enforce backup rules
      hasBak <- testfile bak
      cleanHtml <-
        if hasBak
          then BS.readFile (encodeString bak)
          else do
            current <- BS.readFile (encodeString wb)
            if "clickedButtons" `BS.isInfixOf` current
              then die "Abort: Target already patched, but no backup exists."
              else return current

      -- Prepare HTML
      let payload = generateInjectionScript "all"
          cleanText = TE.decodeUtf8 cleanHtml
          patchedText = T.replace "</body>" (TE.decodeUtf8 payload <> "\n</body>") cleanText
          patchedBytes = TE.encodeUtf8 patchedText

      -- Build write queue immutably
      let baseWrites = [WriteOp wb patchedBytes]
      let writesWithBak = if hasBak then baseWrites else WriteOp bak cleanHtml : baseWrites

      -- Handle product.json backups
      hasProd <- testfile prod
      hasProdBak <- testfile prodBak

      writesWithProdBak <-
        if hasProd && not hasProdBak
          then do
            prodBytes <- BS.readFile (encodeString prod)
            return $ WriteOp prodBak prodBytes : writesWithBak
          else return writesWithBak

      finalWrites <- queueChecksum writesWithProdBak prod patchedBytes

      -- Commit to OS
      writeElevated finalWrites
      echo "Patch completed successfully."
