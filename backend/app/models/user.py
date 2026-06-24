import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    avatar_url = Column(Text, nullable=True)
    plan = Column(String(20), nullable=False, default="free")
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    api_keys = relationship("UserApiKey", back_populates="user", cascade="all, delete-orphan")
    refresh_tokens = relationship("RefreshToken", back_populates="user", cascade="all, delete-orphan")


class UserApiKey(Base):
    __tablename__ = "user_api_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    service = Column(String(50), nullable=False)
    encrypted_key = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="api_keys")

    __table_args__ = (
        # Unique constraint on (user_id, service) is handled by init.sql
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token = Column(String(512), unique=True, nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

    user = relationship("User", back_populates="refresh_tokens")


class UsageLog(Base):
    __tablename__ = "usage_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    service = Column(String(50), nullable=False)
    operation = Column(String(100), nullable=False)
    tokens = Column(Integer, default=0)
    characters = Column(Integer, default=0)
    estimated_cost = Column(Numeric(10, 6), default=0)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
