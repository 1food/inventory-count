"""관리자 WebAuthn(패스키) 등록·인증 서비스.

관리자 코드로 연 세션에서만 등록할 수 있고, 등록 후에는 지문·Face ID·기기 잠금으로
관리 페이지를 열 수 있다. 패스키는 고정 HTTPS 주소(PASSKEY_RP_ID/ORIGIN)에 묶인다.
두 값이 비어 있으면 enabled()=False 이고 화면에서도 패스키 기능을 숨긴다.
"""
from __future__ import annotations

import json
import uuid

from webauthn import (base64url_to_bytes, generate_authentication_options,
                      generate_registration_options, options_to_json,
                      verify_authentication_response, verify_registration_response)
from webauthn.helpers import bytes_to_base64url
from webauthn.helpers.structs import (AuthenticatorSelectionCriteria, AuthenticatorTransport,
                                      PublicKeyCredentialDescriptor, ResidentKeyRequirement,
                                      UserVerificationRequirement)

from . import database
from .config import ORG_NAME, PASSKEY_ORIGIN, PASSKEY_RP_ID

_RP_NAME = f"{ORG_NAME} 재물조사"


def enabled() -> bool:
    return bool(PASSKEY_RP_ID and PASSKEY_ORIGIN)


def _transports(values) -> list[AuthenticatorTransport]:
    valid = {item.value: item for item in AuthenticatorTransport}
    return [valid[v] for v in values if v in valid]


def _descriptors() -> list[PublicKeyCredentialDescriptor]:
    return [
        PublicKeyCredentialDescriptor(
            id=base64url_to_bytes(item["credential_id"]),
            transports=_transports(item["transports"]) or None,
        )
        for item in database.passkey_list()
    ]


def public(item: dict) -> dict:
    return {k: item[k] for k in ("id", "name", "created_at", "last_used_at", "backed_up")}


def registration_options() -> dict:
    if not enabled():
        raise ValueError("패스키 주소(PASSKEY_RP_ID·PASSKEY_ORIGIN)가 설정되지 않았습니다.")
    options = generate_registration_options(
        rp_id=PASSKEY_RP_ID, rp_name=_RP_NAME,
        user_id=b"inventory-count-admin",
        user_name="inventory-count-admin", user_display_name="재물조사 관리자",
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=_descriptors(),
    )
    challenge_id = uuid.uuid4().hex
    database.save_challenge(challenge_id, "registration", options.challenge)
    payload = json.loads(options_to_json(options))
    payload["challenge_id"] = challenge_id
    return payload


def verify_registration(payload: dict) -> dict:
    challenge = database.consume_challenge(str(payload.get("challenge_id") or ""), "registration")
    credential = payload.get("credential")
    if not challenge or not isinstance(credential, dict):
        raise ValueError("패스키 등록 요청이 만료되었습니다. 다시 시도하세요.")
    verified = verify_registration_response(
        credential=credential, expected_challenge=challenge,
        expected_rp_id=PASSKEY_RP_ID, expected_origin=PASSKEY_ORIGIN,
        require_user_verification=True,
    )
    credential_id = bytes_to_base64url(verified.credential_id)
    if database.passkey_get(credential_id):
        raise ValueError("이미 등록된 패스키입니다.")
    raw_transports = credential.get("response", {}).get("transports") or []
    name = (str(payload.get("name") or "").strip()
            or f"패스키 {len(database.passkey_list()) + 1}")[:40]
    passkey_id = database.passkey_add(
        credential_id=credential_id, public_key=verified.credential_public_key,
        sign_count=verified.sign_count,
        transports=[t.value for t in _transports(raw_transports)],
        device_type=verified.credential_device_type.value,
        backed_up=verified.credential_backed_up, name=name,
    )
    return next(public(p) for p in database.passkey_list() if p["id"] == passkey_id)


def authentication_options() -> dict:
    if not database.passkey_list():
        raise LookupError("등록된 패스키가 없습니다. 관리자 코드로 먼저 등록하세요.")
    options = generate_authentication_options(
        rp_id=PASSKEY_RP_ID, allow_credentials=_descriptors(),
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    challenge_id = uuid.uuid4().hex
    database.save_challenge(challenge_id, "authentication", options.challenge)
    payload = json.loads(options_to_json(options))
    payload["challenge_id"] = challenge_id
    return payload


def verify_authentication(payload: dict) -> None:
    challenge = database.consume_challenge(str(payload.get("challenge_id") or ""), "authentication")
    credential = payload.get("credential")
    if not challenge or not isinstance(credential, dict):
        raise ValueError("패스키 확인 요청이 만료되었습니다. 다시 시도하세요.")
    credential_id = bytes_to_base64url(base64url_to_bytes(str(credential.get("id") or "")))
    stored = database.passkey_get(credential_id)
    if not stored:
        raise PermissionError("등록되지 않은 패스키입니다.")
    verified = verify_authentication_response(
        credential=credential, expected_challenge=challenge,
        expected_rp_id=PASSKEY_RP_ID, expected_origin=PASSKEY_ORIGIN,
        credential_public_key=bytes(stored["public_key"]),
        credential_current_sign_count=int(stored["sign_count"]),
        require_user_verification=True,
    )
    database.passkey_touch(
        credential_id, verified.new_sign_count,
        verified.credential_device_type.value, verified.credential_backed_up,
    )
