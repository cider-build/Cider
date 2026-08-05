from datetime import datetime

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel

from .base import new_id, utc_now


class Organization(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    name: str
    created_at: datetime = Field(default_factory=utc_now)


class User(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    email: str = Field(unique=True, index=True)
    created_at: datetime = Field(default_factory=utc_now)


class OrganizationMembership(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("organization_id", "user_id"),)

    id: str = Field(default_factory=new_id, primary_key=True)
    organization_id: str = Field(foreign_key="organization.id", index=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=utc_now)


class LocalCredential(SQLModel, table=True):
    user_id: str = Field(foreign_key="user.id", primary_key=True)
    password_hash: str
    created_at: datetime = Field(default_factory=utc_now)


class UserIdentity(SQLModel, table=True):
    __table_args__ = (UniqueConstraint("provider", "subject"),)

    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    provider: str = Field(index=True)
    subject: str = Field(index=True)
    created_at: datetime = Field(default_factory=utc_now)


class AuthSession(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    token_hash: str = Field(unique=True, index=True)
    expires_at: datetime = Field(index=True)
    created_at: datetime = Field(default_factory=utc_now)


class ApiToken(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    user_id: str = Field(foreign_key="user.id", index=True)
    token_hash: str = Field(unique=True, index=True)
    name: str
    expires_at: datetime = Field(index=True)
    created_at: datetime = Field(default_factory=utc_now)
